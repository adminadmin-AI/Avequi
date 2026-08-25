/**
 * Importador de Suppliers a partir das NF-e RECEBIDAS (#611, PR-A).
 *
 * AUTORIDADE da existência: o próprio ERP pós-reidratação —
 *   FiscalDocument WHERE direction='RECEBIDA' AND supplierId IS NULL
 *   AND issuerCnpj preenchido, agrupado por (companyId, issuerCnpj).
 * Enriquecimento por campo (ver supplier-import.rules.ts): XML da própria
 * nota (guardado em FiscalDocument.xml) → Supplier homônimo de outro tenant
 * (SÓ campos classe A, campo a campo) → Omie (fantasia, via --omie-json).
 *
 * SEGURANÇA:
 *  - dry-run por PADRÃO: sem --commit não executa nenhum INSERT;
 *  - nunca UPDATE/DELETE (só cria cadastro novo; existente = ALREADY_EXISTS);
 *  - idempotente: reexecução após commit → 0 criações;
 *  - identidade quebrada ou IE ambígua → REVIEW (não cria; lista no relatório);
 *  - 1 INSERT por transação implícita; abort do processo não deixa nada parcial.
 *
 * Uso:
 *   ts-node scripts/import-suppliers-from-fiscal.ts [--commit]
 *       [--omie-json caminho.json]   # { "<cnpj14>": "fantasia", ... }
 *       [--report <dir>]
 */
/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  CandidateSources,
  CROSS_TENANT_REUSABLE_FIELDS,
  DatedEmit,
  assessConflicts,
  buildSupplierDraft,
  decideCreation,
  mergeEmitsNewestFirst,
  normalizeCnpj,
  orderEvidenceNewestFirst,
  pairKey,
  parseEmit,
} from '../src/modules/supplier/supplier-import.rules';
import { sameIdSet } from '../src/fiscal/rehydration/rehydration-core';

interface Args {
  commit: boolean;
  omieJson: string | null;
  report: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { commit: false, omieJson: null, report: '.' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit') args.commit = true;
    else if (a === '--omie-json') args.omieJson = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const omie: Record<string, string> = args.omieJson
    ? JSON.parse(fs.readFileSync(args.omieJson, 'utf-8'))
    : {};

  // ── candidatos: autoridade é o FiscalDocument canônico ──
  const docs = await prisma.$queryRawUnsafe<any[]>(`
    SELECT d.id, d."companyId", d."issuerCnpj", d."issuerName",
           d."issueDate"::text AS issue_date, (d.xml IS NOT NULL) AS has_xml
    FROM gdr_fiscal_documents d
    WHERE d.direction = 'RECEBIDA' AND d."supplierId" IS NULL
      AND d."issuerCnpj" IS NOT NULL AND d."issuerCnpj" <> ''
    ORDER BY d."issueDate" DESC NULLS LAST`);

  const companies = await prisma.$queryRawUnsafe<any[]>('SELECT id, name FROM gdr_companies');
  const coName = (id: string) => companies.find((c) => c.id === id)?.name ?? id;
  const suppliers = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, "companyId", cnpj, name, razao_social AS "razaoSocial", ie, tax_regime AS "taxRegime",
            address, number, complement, neighborhood, city, state, zip_code AS "zipCode", ibge_code AS "ibgeCode"
     FROM gdr_suppliers`,
  );

  // agrupa por (companyId, cnpj); a ordem de leitura NÃO importa — a
  // ordenação temporal é feita explicitamente por issueDate/docId depois
  const groups = new Map<
    string,
    { companyId: string; cnpj: string; docIds: string[]; names: Set<string>; xmlDocs: Array<{ id: string; issueDate: string | null }> }
  >();
  for (const d of docs) {
    const cnpj = normalizeCnpj(d.issuerCnpj);
    const key = pairKey(d.companyId, cnpj);
    if (!groups.has(key)) {
      groups.set(key, { companyId: d.companyId, cnpj, docIds: [], names: new Set(), xmlDocs: [] });
    }
    const g = groups.get(key)!;
    g.docIds.push(d.id);
    if (d.issuerName) g.names.add(d.issuerName);
    if (d.has_xml) g.xmlDocs.push({ id: d.id, issueDate: d.issue_date });
  }

  const results: any[] = [];
  for (const g of groups.values()) {
    // evidências dos XMLs confiáveis, ordenadas DETERMINISTICAMENTE por
    // issueDate desc (desempate docId asc) — máx. 5 mais recentes (o conflito
    // material é decidido pelos 2 mais recentes; o resto é história)
    const newestDocs = [...g.xmlDocs]
      .sort((a, b) => {
        const ta = a.issueDate ? Date.parse(a.issueDate) : Number.NEGATIVE_INFINITY;
        const tb = b.issueDate ? Date.parse(b.issueDate) : Number.NEGATIVE_INFINITY;
        if (tb !== ta) return tb - ta;
        return a.id < b.id ? -1 : 1;
      })
      .slice(0, 5);
    const dated: DatedEmit[] = [];
    for (const doc of newestDocs) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(
        'SELECT xml FROM gdr_fiscal_documents WHERE id = $1',
        doc.id,
      );
      const e = parseEmit(row?.xml ?? null);
      if (e) dated.push({ emit: e, issueDate: doc.issueDate, docId: doc.id });
    }
    const emits = orderEvidenceNewestFirst(dated);
    const conflict = assessConflicts(g.cnpj, {
      emitsNewestFirst: emits,
      distinctIssuerNames: [...g.names].sort(),
    });

    // match local: SÓ o mesmo tenant conta; outro tenant é fonte auxiliar
    const sameTenant = suppliers.find(
      (s) => s.companyId === g.companyId && normalizeCnpj(s.cnpj) === g.cnpj,
    );
    const otherTenant = suppliers.find(
      (s) => s.companyId !== g.companyId && normalizeCnpj(s.cnpj) === g.cnpj,
    );
    const crossTenant = otherTenant
      ? Object.fromEntries(CROSS_TENANT_REUSABLE_FIELDS.map((f) => [f, otherTenant[f] ?? null]))
      : null;

    const sources: CandidateSources = {
      companyId: g.companyId,
      issuerCnpj: g.cnpj,
      issuerName: [...g.names].sort()[0] ?? null,
      // consolidação por campo: cada campo vem da evidência MAIS RECENTE que o
      // possui — dado antigo nunca sobrescreve dado novo
      latestEmit: mergeEmitsNewestFirst(emits),
      crossTenant: crossTenant as CandidateSources['crossTenant'],
      omieFantasia: omie[g.cnpj] ?? null,
    };
    const draft = buildSupplierDraft(sources);
    const decision = decideCreation(!!sameTenant, conflict);
    results.push({
      companyId: g.companyId,
      company: coName(g.companyId),
      cnpj: g.cnpj,
      decision,
      draft,
      docCount: g.docIds.length,
      xmlCount: g.xmlDocs.length,
      conflictReasons: conflict.reasons,
      notes: conflict.notes,
      usedCrossTenant: !!crossTenant,
      usedOmie: !!omie[g.cnpj],
    });
  }

  const byDecision = (d: string) => results.filter((r) => r.decision === d);
  const report = {
    commit: args.commit,
    executedAt: new Date().toISOString(),
    candidatos: results.length,
    cnpjsDistintos: new Set(results.map((r) => r.cnpj)).size,
    documentosParaReligarDepois: results.reduce((n, r) => n + r.docCount, 0),
    decisao: {
      CREATE: byDecision('CREATE').length,
      ALREADY_EXISTS: byDecision('ALREADY_EXISTS').length,
      REVIEW: byDecision('REVIEW').length,
    },
    porCompany: Object.fromEntries(
      [...new Set(results.map((r) => r.company))].map((co) => [
        co,
        results.filter((r) => r.company === co).length,
      ]),
    ),
    review: byDecision('REVIEW').map((r) => ({ company: r.company, cnpj: r.cnpj, reasons: r.conflictReasons })),
    pares: results
      .sort((a, b) => b.docCount - a.docCount)
      .map((r) => ({
        company: r.company,
        cnpj: r.cnpj,
        decision: r.decision,
        name: r.draft.name,
        razaoSocial: r.draft.razaoSocial,
        ie: r.draft.ie,
        city: r.draft.city,
        state: r.draft.state,
        docs: r.docCount,
        xmls: r.xmlCount,
        crossTenant: r.usedCrossTenant,
        omie: r.usedOmie,
        notes: r.notes,
      })),
  };
  fs.mkdirSync(args.report, { recursive: true });
  const reportPath = path.join(args.report, `import-suppliers-${args.commit ? 'commit' : 'dryrun'}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, pares: undefined, review: report.review.slice(0, 10) }, null, 1));
  console.log(`relatório completo: ${reportPath}`);

  // Identidade nominal do que seria criado — o gate do --commit compara este
  // CONJUNTO (não a quantidade) com o do dry-run do dia.
  const createPairs = byDecision('CREATE')
    .map((r) => pairKey(r.companyId, r.cnpj))
    .sort();
  const evidencePath = path.join(args.report, '.import-suppliers-dryrun.json');

  if (!args.commit) {
    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        day: report.executedAt.slice(0, 10),
        createPairs,
        reviewPairs: byDecision('REVIEW').map((r) => pairKey(r.companyId, r.cnpj)).sort(),
        counts: report.decisao,
      }),
    );
    console.log('dry-run: NENHUMA escrita foi executada.');
    await prisma.$disconnect();
    return 0;
  }

  // ── GATE NOMINAL (mesmo princípio do reidratador) ──
  // O universo foi recomputado acima, imediatamente antes da escrita; agora o
  // conjunto recomputado tem de ser EXATAMENTE o aprovado no dry-run do dia.
  // Candidato novo, removido, mudança de tenant/CNPJ ou candidato que virou
  // REVIEW alteram o conjunto ⇒ abort + novo dry-run. Um Supplier criado
  // legitimamente entre o dry-run e o commit também muda o conjunto (o par sai
  // de CREATE) ⇒ abort — mudança de snapshot exige nova aprovação; o ON
  // CONFLICT abaixo fica só como última defesa contra race condition.
  if (!fs.existsSync(evidencePath)) {
    console.error('ABORT: --commit exige dry-run prévio (evidência ausente). Nada foi escrito.');
    await prisma.$disconnect();
    return 2;
  }
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
  if (evidence.day !== report.executedAt.slice(0, 10)) {
    console.error('ABORT: evidência de dry-run não é de hoje. Rode o dry-run de novo. Nada foi escrito.');
    await prisma.$disconnect();
    return 2;
  }
  if (!Array.isArray(evidence.createPairs) || !sameIdSet(evidence.createPairs, createPairs)) {
    console.error(
      `ABORT: conjunto nominal a criar (${createPairs.length} pares) difere da evidência do dry-run ` +
        `(${evidence.createPairs?.length ?? 'ausente'}). O snapshot mudou — rode novo dry-run e revalide. Nada foi escrito.`,
    );
    await prisma.$disconnect();
    return 2;
  }

  // ── COMMIT: só INSERT, um por vez; nunca UPDATE/DELETE ──
  let created = 0;
  let failed = 0;
  for (const r of byDecision('CREATE')) {
    const d = r.draft;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO gdr_suppliers (id, "companyId", name, razao_social, cnpj, ie, tax_regime,
            address, number, complement, neighborhood, city, state, zip_code, ibge_code, phone,
            "leadTimeDays", "isActive", "createdAt", "updatedAt")
         VALUES ('sup_' || replace(gen_random_uuid()::text, '-', ''), $1, $2, $3, $4, $5, $6::"TaxRegime",
            $7, $8, $9, $10, $11, $12, $13, $14, $15, 0, true, now(), now())
         ON CONFLICT ("companyId", cnpj) DO NOTHING`,
        d.companyId, d.name, d.razaoSocial, d.cnpj, d.ie, d.taxRegime,
        d.address, d.number, d.complement, d.neighborhood, d.city, d.state, d.zipCode, d.ibgeCode, d.phone,
      );
      created++;
    } catch (err) {
      failed++;
      console.error(`FAILED ${r.company} ${r.cnpj}:`, (err as Error).message);
    }
  }
  console.log(`commit: CREATED=${created} REVIEW_SKIPPED=${byDecision('REVIEW').length} FAILED=${failed}`);
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
