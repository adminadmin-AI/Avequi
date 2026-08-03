import { readFileSync, readdirSync, statSync } from 'fs';
import { basename, join, relative, sep } from 'path';
import * as ts from 'typescript';

/**
 * Tenant Query Lint — OPS WP7 (#914), evolução do fix da #158.
 *
 * Análise ESTÁTICA (AST do TypeScript, sem type-checker): encontra chamadas
 * Prisma em modelos multi-tenant cujo filtro não menciona o tenant. É a
 * fronteira de DADOS da blindagem — o gate de ROTA é o
 * tenant-isolation.sweep.spec; os dois juntos reproduzem como regressão os
 * incidentes #36 (findMany aberto), #63 (update por id sem filtro de tenant),
 * #216/#218 (RLS teatro / findOne sem filtro).
 *
 * ── Regras ──────────────────────────────────────────────────────────────────
 *  Modelo multi-tenant = modelo do schema.prisma com campo DIRETO `companyId`.
 *
 *  Uma chamada é aprovada se houver EVIDÊNCIA DE TENANT (`companyId` ou
 *  filtro de relação `company:`) nos argumentos da chamada OU no corpo do
 *  MÉTODO que a contém — cobre `where: { id, companyId }`, o `where` montado
 *  em variável e o padrão fetch-então-confere. É deliberadamente uma
 *  heurística de MÉTODO: o método que menciona companyId em algum lugar
 *  passa. O alvo é a classe de bug dos incidentes (#36/#63/#216/#218):
 *  método SEM NENHUMA noção de tenant consultando modelo multi-tenant —
 *  esses continuam sendo flagrados com zero falso-negativo (fixtures).
 *
 * ── Exceções ────────────────────────────────────────────────────────────────
 *  - modules/ops/**: ÚNICO módulo autorizado a enxergar cross-tenant (a
 *    fronteira dele é provada por guards + sweep, não por filtro de query);
 *  - waiver por linha: comentário `// tenant-lint: ok (<motivo>)` na linha da
 *    chamada ou na linha imediatamente acima — sempre com motivo, revisável
 *    em code review como qualquer exceção de segurança.
 */

export const LIST_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

export const UNIQUE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
]);

const TENANT_EVIDENCE = /companyId|company\s*:/;
const WAIVER = /tenant-lint:\s*ok\s*\((.+?)\)/;

export interface TenantLintOffender {
  file: string; // relativo ao dir varrido
  line: number; // 1-indexed
  model: string;
  op: string;
  tier: 'lista' | 'unico';
  snippet: string;
}

/** Modelos do schema.prisma com campo DIRETO companyId → nome da propriedade
 *  no client (camelCase). Modelos filhos (isolados via pai) ficam fora por
 *  design — o isolamento deles é provado na raiz da agregação. */
export function parseTenantModels(schemaText: string): Set<string> {
  const models = new Set<string>();
  const blocks = schemaText.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g);
  for (const [, name, body] of blocks) {
    if (/^\s*companyId\s+String/m.test(body)) {
      models.add(name.charAt(0).toLowerCase() + name.slice(1));
    }
  }
  return models;
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...collectFiles(p));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function enclosingCallableText(node: ts.Node, sf: ts.SourceFile): string {
  // Sobe até o MÉTODO/função nomeada mais próxima — arrows/closures no meio
  // (callbacks de map, $transaction) NÃO param a subida: o escopo de decisão
  // de tenant é o método do service, não o callback.
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (ts.isMethodDeclaration(cur) || ts.isFunctionDeclaration(cur)) {
      return cur.getText(sf);
    }
    cur = cur.parent;
  }
  return sf.getFullText(); // top-level: o arquivo é o escopo
}

function hasWaiver(sf: ts.SourceFile, lines: string[], line: number): boolean {
  const own = lines[line - 1] ?? '';
  const above = lines[line - 2] ?? '';
  return WAIVER.test(own) || WAIVER.test(above);
}

export function lintSource(
  sourceText: string,
  fileLabel: string,
  tenantModels: Set<string>,
): TenantLintOffender[] {
  const sf = ts.createSourceFile(fileLabel, sourceText, ts.ScriptTarget.ES2022, true);
  const lines = sourceText.split('\n');
  const offenders: TenantLintOffender[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const op = node.expression.name.text;
      const receiver = node.expression.expression;
      if (
        (LIST_OPS.has(op) || UNIQUE_OPS.has(op)) &&
        ts.isPropertyAccessExpression(receiver) &&
        tenantModels.has(receiver.name.text)
      ) {
        const model = receiver.name.text;
        const tier = LIST_OPS.has(op) ? 'lista' : 'unico';
        const args = node.arguments.map((a) => a.getText(sf)).join(',');
        const aprovado =
          TENANT_EVIDENCE.test(args) ||
          TENANT_EVIDENCE.test(enclosingCallableText(node, sf));
        if (!aprovado) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          if (!hasWaiver(sf, lines, line + 1)) {
            offenders.push({
              file: fileLabel,
              line: line + 1,
              model,
              op,
              tier,
              snippet: node.getText(sf).slice(0, 120).replace(/\s+/g, ' '),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return offenders;
}

/** DTOs não declaram identificador de tenant (classe do incidente #158):
 *  propriedade companyId/tenantId em .dto.ts é sempre offender — o valor vem
 *  do JWT, nunca do cliente. AST de verdade: comentário citando companyId
 *  (o padrão da casa) NÃO flagra. */
export function lintDtoSource(
  sourceText: string,
  fileLabel: string,
): TenantLintOffender[] {
  const sf = ts.createSourceFile(fileLabel, sourceText, ts.ScriptTarget.ES2022, true);
  const offenders: TenantLintOffender[] = [];
  const FORBIDDEN = /^(companyId|company_id|tenantId|tenant_id)$/i;
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      FORBIDDEN.test(node.name.text)
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      offenders.push({
        file: fileLabel,
        line: line + 1,
        model: 'dto',
        op: node.name.text,
        tier: 'unico',
        snippet: node.getText(sf).slice(0, 120).replace(/\s+/g, ' '),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return offenders;
}

export interface TenantLintReport {
  scannedFiles: number;
  offenders: TenantLintOffender[];
}

/** Varre um diretório de módulos (modules/ops fora por design). */
export function lintModulesDir(modulesDir: string): TenantLintReport {
  const schemaPath = join(modulesDir, '../../prisma/schema.prisma');
  const tenantModels = parseTenantModels(readFileSync(schemaPath, 'utf8'));
  const offenders: TenantLintOffender[] = [];
  let scannedFiles = 0;
  for (const file of collectFiles(modulesDir)) {
    const rel = relative(modulesDir, file).split(sep).join('/');
    if (rel.startsWith('ops/')) continue; // fronteira provada por guards+sweep
    const source = readFileSync(file, 'utf8');
    scannedFiles += 1;
    offenders.push(
      ...(basename(file).endsWith('.dto.ts')
        ? lintDtoSource(source, rel)
        : lintSource(source, rel, tenantModels)),
    );
    // services também declaram DTO inline às vezes — cobre ambos nos .ts comuns
    if (!basename(file).endsWith('.dto.ts') && rel.includes('/dto/')) {
      offenders.push(...lintDtoSource(source, rel));
    }
  }
  return { scannedFiles, offenders };
}
