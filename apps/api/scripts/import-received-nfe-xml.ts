/**
 * Importador canônico de NF-e RECEBIDAS a partir de XML (#608, PR-0 — XMLs locais).
 *
 * Lê recursivamente uma ou mais pastas de XML (export do Qive: nfeProc
 * autorizadas, canceladas e procEventoNFe), classifica cada arquivo e planeja
 * a escrita em FiscalDocument / FiscalDocumentItem / FiscalDocumentItemTax —
 * a MESMA fundação (parser + núcleo + escritor) que o fluxo Focus usará.
 *
 * SEGURANÇA (mesmo protocolo do reidratador e do importador de fornecedores):
 *  - dry-run é o PADRÃO: sem --commit não executa nenhum INSERT/UPDATE;
 *  - --commit exige evidência de dry-run do MESMO dia e o conjunto NOMINAL
 *    (chaves a inserir + documentos a atualizar) idêntico ao do dry-run;
 *  - aborta antes de escrever se houver CONFLICT no lote ou se a evidência
 *    divergir (mudança de universo);
 *  - 1 documento = 1 transação (doc + itens + impostos juntos ou nada);
 *  - reexecução após commit ⇒ UNCHANGED (idempotência por comparação);
 *  - nunca cria Supplier; nunca reescreve itens/impostos existentes;
 *  - eventos: só cancelamento REGISTRADO muda o documento; CC-e e manifestação
 *    são reportados e os arquivos preservados (sem representação improvisada).
 *
 * Uso:
 *   ts-node scripts/import-received-nfe-xml.ts --dir <pasta> [--dir <pasta2>]
 *       [--report <dir>] [--company <cnpj>] [--limit N] [--commit]
 */
/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeCnpj, sameIdSet, CompanyRow, SupplierRow } from '../src/fiscal/rehydration/rehydration-core';
import {
  BatchResult,
  ExistingDoc,
  ImportPlan,
  ParsedFile,
  nominalEvidence,
  planBatch,
} from '../src/fiscal/inbound/received-nfe-import-core';
import { applyPlan, parseFileContent } from '../src/fiscal/inbound/received-nfe-import-writer';

interface Args {
  dirs: string[];
  report: string;
  company: string | null;
  limit: number | null;
  commit: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dirs: [], report: '.', company: null, limit: null, commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dirs.push(argv[++i]);
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--company') args.company = normalizeCnpj(argv[++i]);
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--commit') args.commit = true;
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (args.dirs.length === 0) throw new Error('--dir <pasta> é obrigatório (pode repetir)');
  return args;
}

function walkXml(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && /\.xml$/i.test(e.name)) out.push(p);
    }
  }
  return out.sort();
}

/** Respeita a declaração de encoding do XML (Qive exporta UTF-8; legado pode ser ISO-8859-1). */
function readXml(file: string): string {
  const buf = fs.readFileSync(file);
  const head = buf.subarray(0, 200).toString('latin1');
  const m = head.match(/encoding=["']([^"']+)["']/i);
  const enc = (m?.[1] ?? 'utf-8').toLowerCase();
  if (enc === 'iso-8859-1' || enc === 'latin1' || enc === 'windows-1252') return buf.toString('latin1');
  return buf.toString('utf-8');
}

async function loadExisting(prisma: PrismaClient, chaves: string[]): Promise<Map<string, ExistingDoc[]>> {
  const map = new Map<string, ExistingDoc[]>();
  if (chaves.length === 0) return map;
  const docs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT d.id, d."companyId", d.direction::text AS direction, d.status::text AS status, d.type::text AS type,
            d.chave, d."issuerCnpj", d.number, d.series, d."vNF"::text AS "vNF", d."supplierId",
            (d.xml IS NOT NULL) AS "xmlPresent", d."cancelledAt"::text AS "cancelledAt"
     FROM gdr_fiscal_documents d WHERE d.chave = ANY($1::text[])`,
    chaves,
  );
  const ids = docs.map((d) => d.id);
  const items = ids.length
    ? await prisma.$queryRawUnsafe<any[]>(
        `SELECT i.id, i."fiscalDocumentId" AS doc_id, i."nItem", i."productCode",
                i.quantity::text AS quantity, i."unitPrice"::text AS "unitPrice", i."totalPrice"::text AS "totalPrice"
         FROM gdr_fiscal_document_items i WHERE i."fiscalDocumentId" = ANY($1::text[])`,
        ids,
      )
    : [];
  const byDoc = new Map<string, ExistingDoc['items']>();
  for (const r of items) {
    byDoc.set(r.doc_id, [
      ...(byDoc.get(r.doc_id) ?? []),
      { id: r.id, nItem: r.nItem, productCode: r.productCode, quantity: r.quantity, unitPrice: r.unitPrice, totalPrice: r.totalPrice },
    ]);
  }
  for (const d of docs) {
    const doc: ExistingDoc = { ...d, items: byDoc.get(d.id) ?? [] };
    map.set(d.chave, [...(map.get(d.chave) ?? []), doc]);
  }
  return map;
}

function summarize(batch: BatchResult, companies: CompanyRow[], files: string[], xmlByChave: Map<string, string>) {
  const coName = (id: string | null) => companies.find((c) => c.id === id)?.name ?? (id ?? '(sem company)');
  const plans = batch.plans;
  const count = (s: string) => plans.filter((p) => p.state === s).length;
  const perCompany: Record<string, any> = {};
  for (const p of plans) {
    const k = coName(p.companyId);
    perCompany[k] ??= { INSERT: 0, UNCHANGED: 0, UPDATE: 0, CONFLICT: 0, SKIPPED: 0, INVALID: 0, supplierResolvido: 0, supplierAusente: 0, intraGrupo: 0, canceladas: 0, minIssue: null, maxIssue: null };
    const b = perCompany[k];
    b[p.state]++;
    if (p.target && (p.state === 'INSERT' || p.state === 'UPDATE' || p.state === 'UNCHANGED')) {
      if (p.target.supplierId) b.supplierResolvido++;
      else b.supplierAusente++;
      if (p.pendencies.includes('INTRA_GROUP')) b.intraGrupo++;
      if (p.target.status === 'CANCELLED') b.canceladas++;
      const d = p.target.issueDate.slice(0, 10);
      if (!b.minIssue || d < b.minIssue) b.minIssue = d;
      if (!b.maxIssue || d > b.maxIssue) b.maxIssue = d;
    }
  }
  const inserts = plans.filter((p) => p.state === 'INSERT' && p.target);
  const insertDates = inserts.map((p) => p.target!.issueDate.slice(0, 10)).sort();
  const pend = (name: string) => plans.filter((p) => p.pendencies.includes(name as any)).length;
  return {
    arquivos: files.length,
    arquivosInvalidos: batch.invalidFiles.length,
    arquivosDesconhecidos: batch.unknownFiles.length,
    eventosOrfaos: batch.orphanEvents.length,
    chavesDuplicadas: batch.duplicateChaves.length,
    chavesNfe: plans.length,
    xmlBytes: [...xmlByChave.values()].reduce((n, x) => n + Buffer.byteLength(x, 'utf-8'), 0),
    estados: { INSERT: count('INSERT'), UNCHANGED: count('UNCHANGED'), UPDATE: count('UPDATE'), CONFLICT: count('CONFLICT'), SKIPPED: count('SKIPPED'), INVALID: count('INVALID') },
    pendencias: {
      SUPPLIER_MISSING: pend('SUPPLIER_MISSING'),
      INTRA_GROUP: pend('INTRA_GROUP'),
      CCE_NOT_PERSISTED: pend('CCE_NOT_PERSISTED'),
      MANIFEST_EVENT_IGNORED: pend('MANIFEST_EVENT_IGNORED'),
      CANCEL_EVENT_UNREGISTERED: pend('CANCEL_EVENT_UNREGISTERED'),
    },
    insercoes: { total: inserts.length, minIssueDate: insertDates[0] ?? null, maxIssueDate: insertDates[insertDates.length - 1] ?? null, itens: inserts.reduce((n, p) => n + p.target!.items.length, 0), comImposto: inserts.reduce((n, p) => n + p.target!.items.filter((i) => i.tax).length, 0) },
    perCompany,
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  // ── pré-condição: colunas da Fase 1 no banco ──
  const cols = await prisma.$queryRawUnsafe<any[]>(
    `SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'gdr_fiscal_documents' AND column_name IN ('direction', 'issuerCnpj', 'supplierId')`,
  );
  if (cols[0].n !== 3) {
    console.error('ABORT: banco sem as colunas da Fase 1 (migration 20260821120000). Nada foi lido/escrito.');
    await prisma.$disconnect();
    return 2;
  }

  // ── arquivos ──
  const files = args.dirs.flatMap(walkXml);
  const parsed: ParsedFile[] = [];
  const xmlByChave = new Map<string, string>();
  for (const f of files) {
    const xml = readXml(f);
    const pf = parseFileContent(f, xml);
    parsed.push(pf);
    if (pf.doc?.kind === 'NFE' && !xmlByChave.has(pf.doc.chave)) xmlByChave.set(pf.doc.chave, xml);
  }

  // ── contexto do ERP (só SELECT) ──
  const companies = (await prisma.$queryRawUnsafe<any[]>('SELECT id, name, cnpj FROM gdr_companies')) as CompanyRow[];
  const suppliers = (await prisma.$queryRawUnsafe<any[]>('SELECT id, "companyId", cnpj FROM gdr_suppliers')) as SupplierRow[];
  const chaves = [...new Set(parsed.flatMap((p) => (p.doc?.kind === 'NFE' ? [p.doc.chave] : p.doc?.kind === 'EVENTO' ? [p.doc.chNFe] : [])))];
  const existingByChave = await loadExisting(prisma, chaves);
  const erpBefore = (await prisma.$queryRawUnsafe<any[]>(
    `SELECT c.name, count(*)::int AS n, max(d."issueDate")::date::text AS max_issue
     FROM gdr_fiscal_documents d JOIN gdr_companies c ON c.id = d."companyId"
     WHERE d.direction = 'RECEBIDA' GROUP BY c.name ORDER BY c.name`,
  ));

  const batch = planBatch(parsed, { companies, suppliers, existingByChave });

  // filtro --company só afeta EXECUÇÃO; contagens são do lote inteiro
  const companyIdFilter = args.company ? companies.filter((c) => normalizeCnpj(c.cnpj) === args.company).map((c) => c.id) : null;
  const summary = summarize(batch, companies, files, xmlByChave);
  const evidence = nominalEvidence(batch.plans);

  const report = {
    commit: args.commit,
    executedAt: new Date().toISOString(),
    dirs: args.dirs,
    erpRecebidasAntes: erpBefore,
    ...summary,
    evidence,
    conflicts: batch.plans.filter((p) => p.state === 'CONFLICT').map((p) => ({ chave: p.chave, company: companies.find((c) => c.id === p.companyId)?.name ?? null, reasons: p.reasons, existingDocId: p.existingDocId })),
    invalid: batch.plans.filter((p) => p.state === 'INVALID').map((p) => ({ chave: p.chave, reasons: p.reasons })),
    skipped: batch.plans.filter((p) => p.state === 'SKIPPED').map((p) => ({ chave: p.chave, reasons: p.reasons })),
    updates: batch.plans.filter((p) => p.state === 'UPDATE').map((p) => ({ chave: p.chave, docId: p.existingDocId, reasons: p.reasons })),
    supplierMissing: batch.plans
      .filter((p) => p.state === 'INSERT' && p.pendencies.includes('SUPPLIER_MISSING'))
      .map((p) => ({ chave: p.chave, company: companies.find((c) => c.id === p.companyId)?.name, issuerCnpj: p.target!.issuerCnpj, issuerName: p.target!.issuerName, vNF: p.target!.totals.vNF ?? null })),
    invalidFiles: batch.invalidFiles,
    unknownFiles: batch.unknownFiles,
    orphanEvents: batch.orphanEvents,
    duplicateChaves: batch.duplicateChaves,
    insertsSample: batch.plans.filter((p) => p.state === 'INSERT').slice(0, 3).map((p) => ({ chave: p.chave, target: { ...p.target, items: p.target!.items.slice(0, 2) } })),
  };

  fs.mkdirSync(args.report, { recursive: true });
  const reportPath = path.join(args.report, `import-received-nfe-${args.commit ? 'commit' : 'dryrun'}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidence: { insert: evidence.insert.length, update: evidence.update.length }, conflicts: report.conflicts.slice(0, 10), invalid: report.invalid.slice(0, 5), skipped: report.skipped.slice(0, 5), updates: report.updates.slice(0, 10), supplierMissing: report.supplierMissing.slice(0, 10), invalidFiles: report.invalidFiles.slice(0, 5), orphanEvents: report.orphanEvents.length, duplicateChaves: report.duplicateChaves.length, insertsSample: undefined }, null, 1));
  console.log(`relatório completo: ${reportPath}`);
  console.table(Object.entries(summary.perCompany).map(([name, b]: [string, any]) => ({ company: name, ...b })));

  const evidencePath = path.join(args.report, '.import-received-nfe-dryrun.json');
  if (!args.commit) {
    fs.writeFileSync(evidencePath, JSON.stringify({ day: report.executedAt.slice(0, 10), evidence, estados: summary.estados }));
    console.log('dry-run: NENHUMA escrita foi executada.');
    await prisma.$disconnect();
    return summary.estados.CONFLICT === 0 ? 0 : 1;
  }

  // ── GATE do --commit ──
  if (!fs.existsSync(evidencePath)) {
    console.error('ABORT: --commit exige dry-run prévio (evidência ausente). Nada foi escrito.');
    await prisma.$disconnect();
    return 2;
  }
  const ev = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
  if (ev.day !== report.executedAt.slice(0, 10)) {
    console.error('ABORT: evidência de dry-run não é de hoje. Rode o dry-run de novo. Nada foi escrito.');
    await prisma.$disconnect();
    return 2;
  }
  if (summary.estados.CONFLICT > 0) {
    console.error(`ABORT BEFORE WRITE: ${summary.estados.CONFLICT} CONFLICT no lote — resolver antes de escrever.`);
    await prisma.$disconnect();
    return 2;
  }
  if (!sameIdSet(ev.evidence?.insert ?? [], evidence.insert) || !sameIdSet(ev.evidence?.update ?? [], evidence.update)) {
    console.error('ABORT BEFORE WRITE: conjunto nominal (inserts/updates) difere da evidência do dry-run. O universo mudou — rode novo dry-run e revalide.');
    await prisma.$disconnect();
    return 2;
  }

  // ── COMMIT: 1 documento = 1 transação ──
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  const executable: ImportPlan[] = batch.plans.filter((p) => p.state === 'INSERT' || p.state === 'UPDATE');
  for (const plan of executable) {
    if (companyIdFilter && !companyIdFilter.includes(plan.companyId!)) continue;
    if (args.limit !== null && inserted + updated >= args.limit) break;
    const xml = xmlByChave.get(plan.chave);
    if (!xml) {
      failed++;
      console.error(`FAILED ${plan.chave}: XML não encontrado em memória`);
      continue;
    }
    try {
      const r = await prisma.$transaction(async (tx) => applyPlan(tx as any, plan, xml), { timeout: 60_000, maxWait: 15_000 });
      if (r.action === 'INSERT') inserted++;
      else updated++;
    } catch (err) {
      failed++;
      console.error(`FAILED ${plan.chave} (rollback do documento):`, (err as Error).message);
    }
  }
  console.log(`commit: INSERTED=${inserted} UPDATED=${updated} FAILED=${failed}`);
  await prisma.$disconnect();
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  },
);
