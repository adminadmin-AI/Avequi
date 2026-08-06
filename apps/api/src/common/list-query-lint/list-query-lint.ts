import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import * as ts from 'typescript';
import { parseTenantModels } from '../tenant-query-lint/tenant-query-lint';

/**
 * List Query Lint — PERF #1028, irmão do tenant-query-lint (#914).
 *
 * Análise ESTÁTICA (AST do TypeScript, sem type-checker): encontra `findMany`
 * sobre modelo de ALTO VOLUME sem teto (`take`) nem cursor. O achado que
 * motiva: `product.service.ts:70` e `customer.service.ts:90` — `findMany`
 * puro, todas as colunas de todos os registros da conta, sem paginação.
 * Sem gate de CI isso volta a cada endpoint novo — é a mesma lógica que a
 * #914 aplicou ao isolamento de tenant, aplicada a custo de listagem.
 *
 * ── Modelo de alto volume — como é derivado do schema ──────────────────────
 *  Ponto de partida: os mesmos modelos multi-tenant do tenant-query-lint
 *  (campo DIRETO `companyId` no schema.prisma, via `parseTenantModels` —
 *  reaproveitado daqui para não duplicar a heurística nem divergir dela).
 *
 *  Isso é NECESSÁRIO mas não SUFICIENTE: a base tem ~106 modelos
 *  multi-tenant, e boa parte é cadastro/configuração — cresce por AÇÃO
 *  ADMINISTRATIVA pontual (cadastrar um centro de custo, uma regra fiscal,
 *  uma filial), não por OPERAÇÃO ROTINEIRA do usuário (criar pedido,
 *  registrar movimento de estoque, capturar lead). Não existe um único sinal
 *  estrutural (contagem de campos, de relações, de índices) que separe as
 *  duas classes com confiança — comprovado ao tentar: `CostCenter` e
 *  `FinancialCategory` têm tantas relações quanto `Customer`; `Product` e
 *  `Customer` têm a MESMA forma de cadastro (`@@unique([companyId, <chave
 *  de negócio>])`) que `TaxRule`. A distinção é de domínio, não de forma.
 *
 *  Por isso o mecanismo é: sinal automático (multi-tenant) MENOS uma lista
 *  explícita de exceções — `CADASTRO_EXCEPTIONS` — cadastro/configuração
 *  comprovadamente pequeno e estável, com justificativa por linha. A lista
 *  não ficou pequena (35 de 106) porque a base real não é pequena nessa
 *  dimensão; o critério de cada entrada é registro administrativo raro ou
 *  1:1 por usuário/empresa, nunca "parece cadastro". Na dúvida, o modelo
 *  FICA de fora da exceção (conta como alto volume): o custo de um
 *  falso-positivo aqui é pedir `take` numa lista que já era pequena; o custo
 *  de um falso-negativo é o próprio bug que este lint existe para pegar.
 *
 * ── Fora de escopo desta versão (gap conhecido, não bug silencioso) ────────
 *  Modelos FILHOS sem `companyId` direto (isolados via FK do pai — mesma
 *  categoria que o tenant-query-lint deixa de fora "por design") não entram
 *  no `parseTenantModels` e portanto não são vistos aqui. Isso inclui itens
 *  de documento (`SaleItem`, `POItem`, `GRItem`, `FiscalDocumentItem`) E
 *  alguns filhos genuinamente high-volume por si (`WhatsappMessage`,
 *  `BatchEvent`, `LeadActivity`, `ProductionLog`, `RfqItem`...). Resolver
 *  isso exigiria caminhar a cadeia de relações até achar um modelo
 *  multi-tenant — fica para uma v2; registrado aqui para não parecer
 *  cobertura completa quando não é.
 *
 * ── A regra da chamada ──────────────────────────────────────────────────────
 *  Uma chamada `findMany` em modelo de alto volume é aprovada se o PRIMEIRO
 *  NÍVEL do objeto de argumento tiver `take:` OU `cursor:` — diferente do
 *  tenant-query-lint, aqui o escopo é a CHAMADA, não o método: paginação é
 *  uma decisão local da query, não algo que "conta" se aparecer em outro
 *  lugar do método. E é primeiro nível de propósito: teto dentro de
 *  `include`/`select` limita a RELAÇÃO, não a listagem (ver
 *  `hasTopLevelTakeOrCursor`).
 *
 * ── Exceções ────────────────────────────────────────────────────────────────
 *  - waiver por linha: comentário `// list-lint: ok (<motivo>)` na linha da
 *    chamada ou na linha imediatamente acima. Motivo VAZIO não vale — nem
 *    `ok()` nem `ok(   )` nem `ok` sem parênteses contam como waiver; a
 *    chamada continua sendo reportada. Isso é requisito explícito da #1028:
 *    "waiver vira porta dos fundos se aceitar motivo vazio".
 *  - `modules/ops/**`: SEM exceção estrutural aqui (diferente do
 *    tenant-query-lint). A fronteira que o ops prova é de TENANT, não de
 *    VOLUME — uma ferramenta interna que faz `findMany` aberto ainda paga o
 *    mesmo custo de banco. Se algum caso legítimo aparecer lá, resolve por
 *    waiver de linha como qualquer outro módulo.
 */

/** Cadastro/configuração comprovadamente pequeno e estável — cresce por
 *  ação administrativa pontual, não por operação rotineira do usuário.
 *  Retirado do conjunto de modelos multi-tenant do tenant-query-lint. */
export const CADASTRO_EXCEPTIONS: Record<string, string> = {
  subscription: 'assinatura ativa da empresa — poucas linhas por tenant (histórico de plano)',
  subscriptionProposal: 'proposta comercial de upgrade/plano — poucas por tenant',
  tenantEntitlementOverride: 'exceção administrativa pontual de entitlement',
  tenantProvisioning: 'registro único de provisionamento do tenant',
  tenantInvite: 'convite de usuário pendente — dezenas no máximo',
  taxRule: 'regra fiscal cadastrada manualmente — configuração',
  user: 'colaborador da empresa — dezenas/centenas, não milhares',
  userWorkspaceLayout: '1 registro por usuário (layout salvo)',
  userUiPreference: '1 registro por usuário (preferências de UI)',
  supplier: 'cadastro de fornecedores — base tipicamente pequena (não escala como clientes)',
  customerTag: 'tag de segmentação — configuração, poucas dezenas',
  carrier: 'transportadora cadastrada — base pequena e estável',
  warehouse: 'armazém físico — poucos por empresa (GDR tem 3)',
  bankAccount: 'conta bancária da empresa — poucas',
  acquirer: 'adquirente de pagamento cadastrado — poucos',
  discountPolicy: 'política comercial — configuração',
  provisionRule: 'regra de provisão financeira — configuração',
  collectionRule: 'régua de cobrança — configuração',
  systemParameter: 'parâmetro de sistema — configuração',
  workCenter: 'centro de trabalho fabril — poucos por planta (GDR tem 14 setores)',
  financialCategory: 'categoria financeira (plano de contas) — configuração',
  costCenter: 'centro de custo — configuração',
  budgetPlan: 'plano orçamentário — poucos por ciclo',
  budgetDriver: 'driver de orçamento — configuração',
  approvalMatrix: 'matriz de alçada de aprovação — configuração',
  priceTable: 'tabela de preço — poucas por empresa',
  commissionRule: 'regra de comissão — configuração',
  role: 'papel de acesso — poucos por empresa',
  userRoleAssignment: 'atribuição usuário-papel — limitado pelo nº de usuários',
  userPermission: 'permissão avulsa por usuário — limitado pelo nº de usuários',
  branch: 'filial física — poucas por empresa (GDR tem 3)',
  department: 'departamento organizacional — poucos',
  pipelineStage: 'estágio fixo de funil comercial — configuração',
  whatsappTemplate: 'template de mensagem pré-aprovado — configuração',
  quickReply: 'resposta rápida pré-cadastrada — configuração',
};

const WAIVER = /list-lint:\s*ok\s*\((.+?)\)/;

/**
 * Teto provado no PRIMEIRO NÍVEL do argumento da chamada.
 *
 * Precisa ser AST, não regex sobre o texto dos argumentos: `take` aninhado em
 * `include: { items: { take: 5 } }` limita a RELAÇÃO, não a listagem raiz — e
 * uma regex textual aprovaria a query justamente no caso que este lint existe
 * para pegar. Idem para `take:` dentro de string literal no `where`. Os dois
 * casos estão fixados no spec como regressão.
 *
 * Fail-closed deliberado: se o argumento não for um objeto literal (montado em
 * variável, ou com spread que pode ou não trazer o teto), a chamada NÃO é
 * aprovada — não dá para provar o teto estaticamente. Mesma assimetria já
 * assumida na escolha dos modelos: falso-positivo custa um `take` a mais numa
 * lista pequena (ou um waiver com motivo); falso-negativo custa o incidente.
 */
function hasTopLevelTakeOrCursor(node: ts.CallExpression): boolean {
  const arg = node.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
  return arg.properties.some((prop) => {
    if (ts.isSpreadAssignment(prop)) return false; // conteúdo desconhecido
    const name = prop.name;
    if (!name) return false;
    const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
    return key === 'take' || key === 'cursor';
  });
}

export interface ListLintOffender {
  file: string; // relativo ao dir varrido
  line: number; // 1-indexed
  model: string;
  snippet: string;
}

/** Modelos de alto volume: multi-tenant (parseTenantModels) menos a lista
 *  explícita de cadastro/configuração. Ver cabeçalho do arquivo. */
export function parseHighVolumeModels(schemaText: string): Set<string> {
  const tenantModels = parseTenantModels(schemaText);
  const highVolume = new Set<string>();
  for (const model of tenantModels) {
    if (!(model in CADASTRO_EXCEPTIONS)) highVolume.add(model);
  }
  return highVolume;
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

function hasValidWaiver(lines: string[], line: number): boolean {
  const own = lines[line - 1] ?? '';
  const above = lines[line - 2] ?? '';
  const match = WAIVER.exec(own) ?? WAIVER.exec(above);
  if (!match) return false;
  return match[1].trim().length > 0; // motivo vazio/só-espaço NÃO vale
}

export function lintSource(
  sourceText: string,
  fileLabel: string,
  highVolumeModels: Set<string>,
): ListLintOffender[] {
  const sf = ts.createSourceFile(fileLabel, sourceText, ts.ScriptTarget.ES2022, true);
  const lines = sourceText.split('\n');
  const offenders: ListLintOffender[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const op = node.expression.name.text;
      const receiver = node.expression.expression;
      if (
        op === 'findMany' &&
        ts.isPropertyAccessExpression(receiver) &&
        highVolumeModels.has(receiver.name.text)
      ) {
        const model = receiver.name.text;
        if (!hasTopLevelTakeOrCursor(node)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          if (!hasValidWaiver(lines, line + 1)) {
            offenders.push({
              file: fileLabel,
              line: line + 1,
              model,
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

export interface ListLintReport {
  scannedFiles: number;
  offenders: ListLintOffender[];
}

/** Varre um diretório de módulos. Sem exceção estrutural de subpasta (ver
 *  cabeçalho — modules/ops não fica fora aqui, diferente do tenant-lint). */
export function lintModulesDir(modulesDir: string): ListLintReport {
  const schemaPath = join(modulesDir, '../../prisma/schema.prisma');
  const highVolumeModels = parseHighVolumeModels(readFileSync(schemaPath, 'utf8'));
  const offenders: ListLintOffender[] = [];
  let scannedFiles = 0;
  for (const file of collectFiles(modulesDir)) {
    const rel = relative(modulesDir, file).split(sep).join('/');
    const source = readFileSync(file, 'utf8');
    scannedFiles += 1;
    offenders.push(...lintSource(source, rel, highVolumeModels));
  }
  return { scannedFiles, offenders };
}
