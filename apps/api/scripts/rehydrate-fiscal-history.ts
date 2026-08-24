/**
 * Reidratação do histórico fiscal — CLI (etapa 2 de 2).
 *
 * Reconstrói os 11.081 FiscalDocument legados (company, direção, emitente,
 * número/série/chave, datas, protocolo, natureza, tpNF, totais, XML, nItem,
 * origem/modalidadeBC do ICMS e supplierId quando houver match exato) a partir
 * do dataset produzido por rehydrate-extract-source.py. Ver política completa
 * em docs/fiscal/reidratacao-historico.md.
 *
 * SEGURANÇA:
 *  - dry-run é o PADRÃO: sem --commit este programa não executa nenhum
 *    INSERT/UPDATE/DELETE — apenas SELECT e relatório do que SERIA alterado;
 *  - --commit exige: colunas da Fase 1 no banco (migration 20260821120000),
 *    safety assertions do universo auditado passando, zero colisões simuladas
 *    e evidência de dry-run do MESMO dia (arquivo .rehydrate-dryrun.json);
 *  - transação por documento; para os 9 pares intra-grupo, transação POR PAR
 *    (os dois lados juntos ou nada);
 *  - reexecução após commit ⇒ UNCHANGED (idempotente por comparação campo a
 *    campo, sem tabela de status);
 *  - DELETE só do espelho auditado: id na allowlist congelada + revalidação
 *    integral dos invariantes (nunca "DELETE WHERE legacyId LIKE ...").
 *
 * Uso:
 *   ts-node scripts/rehydrate-fiscal-history.ts --source <dir> [--report <dir>]
 *       [--company <cnpj>] [--limit N] [--commit]
 */
/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  AllowlistEntry,
  BuildContext,
  CompanyRow,
  DocResolution,
  ErpDoc,
  ErpItem,
  EXPECTED_FINAL,
  sameIdSet,
  FinalDocKey,
  SourceHeader,
  SourceItem,
  SupplierRow,
  TOTAL_FIELDS,
  buildTarget,
  diffDoc,
  normalizeCnpj,
  safetyAssertions,
  simulateUniqueCollisions,
} from '../src/fiscal/rehydration/rehydration-core';

interface Args {
  source: string;
  report: string;
  company: string | null;
  limit: number | null;
  commit: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { source: '', report: '.', company: null, limit: null, commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--company') args.company = normalizeCnpj(argv[++i]);
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--commit') args.commit = true;
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (!args.source) throw new Error('--source <dir> é obrigatório (saída do rehydrate-extract-source.py)');
  return args;
}

function readJsonl<T>(file: string): T[] {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T);
}

async function loadErp(prisma: PrismaClient, fase1: boolean): Promise<ErpDoc[]> {
  const fase1Cols = fase1
    ? `d."direction"::text AS direction, d."issueDate", d."issuerCnpj", d."issuerName",
       d."recipientCnpj", d."naturezaOperacao", d."tpNF", d."supplierId",
       d."vProd"::text AS "vProd", d."vFrete"::text AS "vFrete", d."vSeg"::text AS "vSeg",
       d."vDesc"::text AS "vDesc", d."vOutro"::text AS "vOutro", d."vIPI"::text AS "vIPI",
       d."vICMS"::text AS "vICMS", d."vICMSUFDest"::text AS "vICMSUFDest",
       d."vFCPUFDest"::text AS "vFCPUFDest", d."vPIS"::text AS "vPIS",
       d."vCOFINS"::text AS "vCOFINS", d."vNF"::text AS "vNF",`
    : '';
  const docs = await prisma.$queryRawUnsafe<any[]>(`
    SELECT d.id, d."companyId", d.type::text AS type, d.status::text AS status,
           d."focusRef", d.chave, d.number, d.series,
           d."authorizedAt"::text AS "authorizedAt", d."protocolNumber",
           ${fase1Cols}
           (d.xml IS NOT NULL) AS "xmlPresent"
    FROM gdr_fiscal_documents d`);
  const items = await prisma.$queryRawUnsafe<any[]>(`
    SELECT i.id, i."fiscalDocumentId" AS doc_id, i."legacyId",
           ${fase1 ? 'i."nItem",' : 'NULL::int AS "nItem",'}
           i."productCode", i."unitPrice"::text AS "unitPrice",
           i.quantity::text AS quantity, i."totalPrice"::text AS "totalPrice",
           t.id AS tax_id,
           ${fase1 ? 't."origemIcms" AS tax_origem, t."modalidadeBcIcms" AS tax_modbc,' : 'NULL::text AS tax_origem, NULL::text AS tax_modbc,'}
           (SELECT count(*) FROM gdr_fiscal_document_item_taxes tt
             WHERE tt."fiscalDocumentItemId" = i.id)::int AS tax_count
    FROM gdr_fiscal_document_items i
    LEFT JOIN LATERAL (
      SELECT * FROM gdr_fiscal_document_item_taxes t2
      WHERE t2."fiscalDocumentItemId" = i.id LIMIT 1
    ) t ON true`);

  const byDoc = new Map<string, ErpItem[]>();
  for (const r of items) {
    const it: ErpItem = {
      id: r.id,
      legacyId: r.legacyId,
      nItem: r.nItem,
      productCode: r.productCode,
      unitPrice: r.unitPrice,
      quantity: r.quantity,
      totalPrice: r.totalPrice,
      taxId: r.tax_id,
      taxOrigemIcms: r.tax_origem,
      taxModalidadeBcIcms: r.tax_modbc,
      taxCount: r.tax_count,
    };
    byDoc.set(r.doc_id, [...(byDoc.get(r.doc_id) ?? []), it]);
  }
  return docs.map((d) => ({
    id: d.id,
    companyId: d.companyId,
    type: d.type,
    status: d.status,
    focusRef: d.focusRef,
    chave: d.chave,
    number: d.number,
    series: d.series,
    authorizedAt: d.authorizedAt,
    protocolNumber: d.protocolNumber,
    direction: fase1 ? d.direction : undefined,
    issueDate: fase1 ? d.issueDate : undefined,
    issuerCnpj: fase1 ? d.issuerCnpj : undefined,
    issuerName: fase1 ? d.issuerName : undefined,
    recipientCnpj: fase1 ? d.recipientCnpj : undefined,
    naturezaOperacao: fase1 ? d.naturezaOperacao : undefined,
    tpNF: fase1 ? d.tpNF : undefined,
    supplierId: fase1 ? d.supplierId : undefined,
    totals: fase1 ? Object.fromEntries(TOTAL_FIELDS.map((f) => [f, d[f] ?? null])) : undefined,
    xmlPresent: d.xmlPresent,
    items: byDoc.get(d.id) ?? [],
  }));
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  // ── modo: a migration da Fase 1 já chegou a este banco? ──
  const cols = await prisma.$queryRawUnsafe<any[]>(
    `SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'gdr_fiscal_documents' AND column_name IN ('direction', 'issuerCnpj')`,
  );
  const fase1 = cols[0].n === 2;
  const mode = fase1 ? 'READY' : 'PRE_MIGRATION';
  console.log(`modo: ${mode} (colunas da Fase 1 ${fase1 ? 'presentes' : 'AUSENTES'} no banco)`);
  if (args.commit && !fase1) {
    console.error('ABORT: --commit exige a migration 20260821120000 aplicada. Nada foi escrito.');
    await prisma.$disconnect();
    return 2;
  }

  // ── fontes ──
  const headers = readJsonl<SourceHeader>(path.join(args.source, 'headers.jsonl'));
  const sourceItems = readJsonl<SourceItem>(path.join(args.source, 'items.jsonl'));
  const allowlist = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../src/fiscal/rehydration/allowlist-intra-group.json'),
      'utf-8',
    ),
  ).pairs as AllowlistEntry[];
  if (allowlist.length !== 18 || new Set(allowlist.map((e) => e.dropItemId)).size !== 18) {
    throw new Error('allowlist corrompida: esperava 18 entradas com dropItemId distintos');
  }

  const companies = (await prisma.$queryRawUnsafe<any[]>(
    'SELECT id, name, cnpj FROM gdr_companies',
  )) as CompanyRow[];
  const suppliers = (await prisma.$queryRawUnsafe<any[]>(
    'SELECT id, "companyId", cnpj FROM gdr_suppliers',
  )) as SupplierRow[];
  const erpDocs = await loadErp(prisma, fase1);

  const ctx: BuildContext = {
    companies,
    suppliers,
    headersByChave: new Map(headers.map((h) => [h.chave, h])),
    sourceByLegacy: new Map(sourceItems.map((i) => [i.legacyId, i])),
    allowlistByDocId: new Map(allowlist.map((e) => [e.docId, e])),
    erpDocIds: new Set(erpDocs.map((d) => d.id)),
  };

  // ── resolução por documento ──
  const resolutions: DocResolution[] = [];
  const diffsByDoc = new Map<string, ReturnType<typeof diffDoc>>();
  for (const doc of erpDocs) {
    const res = buildTarget(doc, ctx);
    if (res.state === 'WOULD_UPDATE' && res.target) {
      const diffs = diffDoc(doc, res.target);
      if (diffs.length === 0) res.state = 'UNCHANGED';
      diffsByDoc.set(doc.id, diffs);
    }
    resolutions.push(res);
  }

  // ── filtro opcional (--company/--limit) só afeta EXECUÇÃO/relatório detalhado;
  //    contagens e assertions são sempre do universo inteiro ──
  const companyIdFilter = args.company
    ? companies.filter((c) => normalizeCnpj(c.cnpj) === args.company).map((c) => c.id)
    : null;

  // ── simulação de colisões nas duas uniques do estado FINAL ──
  const finalKeys: FinalDocKey[] = erpDocs.map((d) => {
    const res = resolutions.find((r) => r.docId === d.id)!;
    if (res.target) {
      return {
        docId: d.id,
        companyId: res.target.companyId,
        chave: res.target.chave,
        issuerCnpj: res.target.issuerCnpj,
        series: res.target.series,
        number: res.target.number,
        type: d.type,
      };
    }
    return {
      docId: d.id,
      companyId: d.companyId,
      chave: d.chave,
      issuerCnpj: fase1 ? (d.issuerCnpj ?? null) : normalizeCnpj(companies.find((c) => c.id === d.companyId)?.cnpj ?? ''),
      series: d.series,
      number: d.number,
      type: d.type,
    };
  });
  const collisions = simulateUniqueCollisions(finalKeys);

  // ── universo/assertions ──
  const historic = resolutions.filter((r) => !['FOCUS_IGNORED'].includes(r.state));
  const withTarget = resolutions.filter((r) => r.target !== null);
  const mirrors = withTarget.filter((r) => r.target!.dropMirrorItemId !== null);
  const totalItems = erpDocs.reduce((n, d) => n + d.items.length, 0);
  // Snapshot com invariantes que valem no estado inicial E num resume state
  // legítimo (execução anterior parcial): a partição UNCHANGED × WOULD_UPDATE
  // pode variar, mas as contas têm de fechar entre si (ver safetyAssertions).
  const counts = {
    totalDocs: erpDocs.length,
    historicDocs: historic.length,
    focusDocs: resolutions.filter((r) => r.state === 'FOCUS_IGNORED').length,
    finalEmitida:
      withTarget.filter((r) => r.target!.direction === 'EMITIDA').length +
      resolutions.filter((r) => r.state === 'FOCUS_IGNORED').length,
    finalRecebida: withTarget.filter((r) => r.target!.direction === 'RECEBIDA').length,
    totalItems,
    pendingMirrors: mirrors.length,
    unchanged: resolutions.filter((r) => r.state === 'UNCHANGED').length,
    wouldUpdate: resolutions.filter((r) => r.state === 'WOULD_UPDATE').length,
    conflicts: resolutions.filter((r) => r.state === 'CONFLICT').length,
    unresolved: resolutions.filter((r) => r.state === 'SKIPPED_UNRESOLVED').length,
  };
  const violations = safetyAssertions(counts);
  // Evidência nominal: quais documentos seriam escritos. O gate do --commit
  // compara este conjunto com o do dry-run do dia — a autorização fica
  // vinculada à evidência, não a um número.
  const wouldUpdateIds = resolutions
    .filter((r) => r.state === 'WOULD_UPDATE')
    .map((r) => r.docId)
    .sort();

  // ── relatório por company (antes/depois) ──
  const coName = (id: string) => companies.find((c) => c.id === id)?.name ?? id;
  const perCompany: Record<string, any> = {};
  for (const res of resolutions) {
    const doc = erpDocs.find((d) => d.id === res.docId)!;
    const from = coName(doc.companyId);
    const to = res.target ? coName(res.target.companyId) : from;
    for (const key of new Set([from, to])) {
      perCompany[key] ??= {
        analisados: 0, UNCHANGED: 0, WOULD_UPDATE: 0, FOCUS_IGNORED: 0,
        SKIPPED_UNRESOLVED: 0, CONFLICT: 0,
        entradaDocs: 0, saidaDocs: 0, chegam: 0, saem: 0,
        xmlOk: 0, xmlAusente: 0, authVerificado: 0, authNaoVerificado: 0,
        supplierResolvido: 0, supplierAusente: 0,
        paresIntraGrupo: 0, wouldDeleteMirror: 0, unitPriceDivergentes: 0,
      };
    }
    const bucket = perCompany[from];
    bucket.analisados++;
    bucket[res.state] = (bucket[res.state] ?? 0) + 1;
    if (res.target) {
      if (to !== from) {
        bucket.saem++;
        perCompany[to].chegam++;
      }
      const t = res.target;
      const dest = perCompany[to];
      if (t.direction === 'RECEBIDA') dest.entradaDocs++;
      else dest.saidaDocs++;
      if (t.pendencies.includes('XML_MISSING')) dest.xmlAusente++;
      else dest.xmlOk++;
      if (t.authorizedAt !== null) dest.authVerificado++;
      else dest.authNaoVerificado++;
      if (t.direction === 'RECEBIDA') {
        if (t.supplierId !== null) dest.supplierResolvido++;
        else dest.supplierAusente++;
      }
      if (t.pendencies.includes('INTRA_GROUP_PAIR')) dest.paresIntraGrupo++;
      if (t.dropMirrorItemId !== null) dest.wouldDeleteMirror++;
      dest.unitPriceDivergentes += t.unitPriceDivergences.length;
    }
  }

  const report = {
    mode,
    commit: args.commit,
    executedAt: new Date().toISOString(),
    counts,
    expected: EXPECTED_FINAL,
    assertionViolations: violations,
    wouldUpdateDocIds: wouldUpdateIds,
    collisions: {
      chave: collisions.chaveCollisions,
      numeracao: collisions.numberCollisions,
    },
    states: Object.fromEntries(
      ['UNCHANGED', 'WOULD_UPDATE', 'FOCUS_IGNORED', 'SKIPPED_UNRESOLVED', 'CONFLICT'].map((s) => [
        s,
        resolutions.filter((r) => r.state === s).length,
      ]),
    ),
    wouldDeleteMirror: mirrors.map((m) => ({
      docId: m.docId,
      itemId: m.target!.dropMirrorItemId,
    })),
    pendencies: {
      AUTH_TIME_UNVERIFIED: withTarget.filter((r) => r.target!.pendencies.includes('AUTH_TIME_UNVERIFIED')).length,
      XML_MISSING: withTarget.filter((r) => r.target!.pendencies.includes('XML_MISSING')).length,
      SUPPLIER_MISSING: withTarget.filter((r) => r.target!.pendencies.includes('SUPPLIER_MISSING')).length,
      UNITPRICE_DIVERGENT: withTarget.reduce((n, r) => n + r.target!.unitPriceDivergences.length, 0),
      unitPriceRepresentationOnly: withTarget.reduce(
        (n, r) => n + r.target!.unitPriceRepresentationOnly,
        0,
      ),
    },
    conflicts: resolutions
      .filter((r) => r.state === 'CONFLICT' || r.state === 'SKIPPED_UNRESOLVED')
      .map((r) => ({ docId: r.docId, state: r.state, reasons: r.reasons })),
    perCompany,
    sampleDiffs: [...diffsByDoc.entries()]
      .filter(([, d]) => d.length > 0)
      .slice(0, 3)
      .map(([docId, d]) => ({ docId, diffs: d.slice(0, 25) })),
  };

  fs.mkdirSync(args.report, { recursive: true });
  const reportPath = path.join(args.report, `rehydrate-report-${args.commit ? 'commit' : 'dryrun'}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, conflicts: report.conflicts.slice(0, 10), sampleDiffs: undefined, wouldDeleteMirror: report.wouldDeleteMirror.length, perCompany: undefined }, null, 1));
  console.log(`relatório completo: ${reportPath}`);
  console.table(
    Object.entries(perCompany).map(([name, b]: [string, any]) => ({ company: name, ...b })),
  );

  if (!args.commit) {
    // evidência de dry-run para o gate do --commit (mesmo dia)
    fs.writeFileSync(
      path.join(args.report, '.rehydrate-dryrun.json'),
      JSON.stringify({ day: report.executedAt.slice(0, 10), counts, violations, collisions: report.collisions, wouldUpdateIds }),
    );
    console.log('dry-run: NENHUMA escrita foi executada.');
    await prisma.$disconnect();
    return violations.length === 0 ? 0 : 1;
  }

  // ── COMMIT (não executado nesta rodada) ──
  const evidencePath = path.join(args.report, '.rehydrate-dryrun.json');
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
  if (violations.length > 0) {
    console.error('ABORT BEFORE WRITE: universo divergente do auditado:', violations);
    await prisma.$disconnect();
    return 2;
  }
  if (collisions.chaveCollisions.length > 0 || collisions.numberCollisions.length > 0) {
    console.error('ABORT BEFORE WRITE: colisões simuladas nas uniques.');
    await prisma.$disconnect();
    return 2;
  }
  // Gate nominal: o conjunto de documentos a escrever AGORA tem de ser
  // exatamente o conjunto provado no dry-run do dia. Um documento a mais (ou a
  // menos) significa que algo mudou depois da evidência → abort before write.
  if (!Array.isArray(evidence.wouldUpdateIds) || !sameIdSet(evidence.wouldUpdateIds, wouldUpdateIds)) {
    console.error(
      `ABORT BEFORE WRITE: conjunto de documentos a escrever (${wouldUpdateIds.length}) difere da evidência do dry-run (${evidence.wouldUpdateIds?.length ?? 'ausente'}). Rode o dry-run de novo e revalide.`,
    );
    await prisma.$disconnect();
    return 2;
  }

  // Unidade de execução: 1 documento = 1 transação; pares intra-grupo = os
  // DOIS documentos do par na MESMA transação (consistência dos dois lados).
  const done = new Set<string>();
  let updated = 0;
  let deletedMirror = 0;
  let failed = 0;
  const execOne = async (tx: any, res: DocResolution) => {
    const t = res.target!;
    if (t.dropMirrorItemId !== null) {
      // DELETE apontado por id auditado — jamais por padrão de legacyId.
      const delRes: number = await tx.$executeRawUnsafe(
        'DELETE FROM gdr_fiscal_document_items WHERE id = $1',
        t.dropMirrorItemId,
      );
      if (delRes !== 1) throw new Error(`espelho ${t.dropMirrorItemId}: DELETE afetou ${delRes} linhas`);
      deletedMirror++;
    }
    await tx.$executeRawUnsafe(
      `UPDATE gdr_fiscal_documents SET
         "companyId" = $1, direction = $2::"FiscalDirection", "issueDate" = $3::timestamptz,
         "issuerCnpj" = $4, "issuerName" = $5, "recipientCnpj" = $6,
         number = $7, series = $8, chave = $9,
         "authorizedAt" = $10::timestamptz, "protocolNumber" = $11,
         "naturezaOperacao" = $12, "tpNF" = $13, "supplierId" = $14,
         "vProd" = $15::numeric, "vFrete" = $16::numeric, "vSeg" = $17::numeric,
         "vDesc" = $18::numeric, "vOutro" = $19::numeric, "vIPI" = $20::numeric,
         "vICMS" = $21::numeric, "vICMSUFDest" = $22::numeric, "vFCPUFDest" = $23::numeric,
         "vPIS" = $24::numeric, "vCOFINS" = $25::numeric, "vNF" = $26::numeric,
         xml = COALESCE($27, xml), "updatedAt" = now()
       WHERE id = $28`,
      t.companyId, t.direction, t.issueDate, t.issuerCnpj, t.issuerName, t.recipientCnpj,
      t.number, t.series, t.chave, t.authorizedAt, t.protocolNumber,
      t.naturezaOperacao, t.tpNF, t.supplierId,
      ...TOTAL_FIELDS.map((f) => t.totals[f] ?? null),
      t.xmlPath ? fs.readFileSync(t.xmlPath, 'utf-8') : null,
      res.docId,
    );
    for (const { itemId, nItem } of t.itemNItems) {
      await tx.$executeRawUnsafe(
        'UPDATE gdr_fiscal_document_items SET "nItem" = $1 WHERE id = $2', nItem, itemId,
      );
    }
    for (const tb of t.taxBackfills) {
      await tx.$executeRawUnsafe(
        `UPDATE gdr_fiscal_document_item_taxes
           SET "origemIcms" = COALESCE("origemIcms", $1),
               "modalidadeBcIcms" = COALESCE("modalidadeBcIcms", $2)
         WHERE id = $3`,
        tb.origemIcms, tb.modalidadeBcIcms, tb.taxId,
      );
    }
    updated++;
  };

  for (const res of resolutions) {
    if (res.state !== 'WOULD_UPDATE' || done.has(res.docId)) continue;
    if (companyIdFilter && !companyIdFilter.includes(res.target!.companyId)) continue;
    if (args.limit !== null && updated >= args.limit) break;
    const entry = ctx.allowlistByDocId.get(res.docId);
    const group: DocResolution[] = [res];
    if (entry) {
      const partner = resolutions.find(
        (r) => r.docId !== res.docId && ctx.allowlistByDocId.get(r.docId)?.chave === entry.chave,
      );
      if (!partner || partner.state === 'CONFLICT') {
        console.error(`par ${entry.chave}: contraparte indisponível — CONFLICT, par não executado`);
        continue;
      }
      if (partner.state === 'WOULD_UPDATE') group.push(partner);
    }
    try {
      // Timeout da transação interativa: o default do Prisma (timeout 5s /
      // maxWait 2s) derrubou 62 documentos na execução de 24/08 por latência
      // de WAN até o banco (us-west-2) em documentos com XML grande. 60s/15s
      // dá margem ampla SEM remover o teto: uma transação presa de verdade
      // ainda expira, faz rollback do documento/par e vira FAILED.
      await prisma.$transaction(
        async (tx) => {
          for (const g of group) await execOne(tx, g);
        },
        { timeout: 60_000, maxWait: 15_000 },
      );
      group.forEach((g) => done.add(g.docId));
    } catch (err) {
      failed++;
      console.error(`FAILED doc ${res.docId} (rollback do documento/par):`, (err as Error).message);
    }
  }
  console.log(`commit: UPDATED=${updated} DELETED_MIRROR=${deletedMirror} FAILED=${failed}`);
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
