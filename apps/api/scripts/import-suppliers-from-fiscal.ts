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
  EmitData,
  assessConflicts,
  buildSupplierDraft,
  decideCreation,
  normalizeCnpj,
  parseEmit,
} from '../src/modules/supplier/supplier-import.rules';

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

  // agrupa por (companyId, cnpj) preservando ordem por recência
  const groups = new Map<string, { companyId: string; cnpj: string; docIds: string[]; names: Set<string>; xmlDocIds: string[] }>();
  for (const d of docs) {
    const cnpj = normalizeCnpj(d.issuerCnpj);
    const key = `${d.companyId}|${cnpj}`;
    if (!groups.has(key)) {
      groups.set(key, { companyId: d.companyId, cnpj, docIds: [], names: new Set(), xmlDocIds: [] });
    }
    const g = groups.get(key)!;
    g.docIds.push(d.id);
    if (d.issuerName) g.names.add(d.issuerName);
    if (d.has_xml) g.xmlDocIds.push(d.id);
  }

  const results: any[] = [];
  for (const g of groups.values()) {
    // emits dos XMLs confiáveis, do mais recente para o mais antigo (máx. 5 — o
    // conflito material é decidido pelos 2 mais recentes; o resto é história)
    const emits: EmitData[] = [];
    for (const docId of g.xmlDocIds.slice(0, 5)) {
      const [row] = await prisma.$queryRawUnsafe<any[]>(
        'SELECT xml FROM gdr_fiscal_documents WHERE id = $1',
        docId,
      );
      const e = parseEmit(row?.xml ?? null);
      if (e) emits.push(e);
    }
    const conflict = assessConflicts(g.cnpj, {
      emitsNewestFirst: emits,
      distinctIssuerNames: [...g.names],
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
      issuerName: [...g.names][0] ?? null,
      latestEmit: emits[0] ?? null,
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
      xmlCount: g.xmlDocIds.length,
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

  if (!args.commit) {
    console.log('dry-run: NENHUMA escrita foi executada.');
    await prisma.$disconnect();
    return 0;
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
