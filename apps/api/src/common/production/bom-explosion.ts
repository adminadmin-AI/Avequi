/**
 * #980 — Núcleo GENÉRICO de explosão de BOM.
 *
 * "Explodir a BOM" é responder: *para produzir N unidades deste produto, de
 * quantas unidades de cada componente eu preciso?* — descendo todos os níveis da
 * árvore (modelo → conjunto → peça) e multiplicando as quantidades.
 *
 * Até a #980 essa lógica existia num único lugar, privada dentro do
 * `MrpService.explodeBom()`, e despejava o resultado num acumulador PLANO
 * indexado por produto. Isso serve ao MRP, que só quer o total ("preciso de 800
 * parafusos"), mas **perde a aresta**: depois de somar não há como saber qual
 * `BomItem`, de qual pai, gerou aquela necessidade.
 *
 * O despacho por setor (#817) precisa exatamente da aresta — a OC de uma
 * operação é composta pelos `BomItem` cujo `routingStepId` aponta para ela
 * (campo criado na #815). Por isso o núcleo emite um **ledger de arestas**, e a
 * agregação plana do MRP passa a ser uma PROJEÇÃO por cima do mesmo ledger.
 * Uma fonte de verdade, duas leituras.
 *
 * Garantias técnicas do mecanismo:
 *   - **`Decimal` do início ao fim.** Nada de `Number` no meio da cadeia: com
 *     BOM de 3 níveis e `scrapPct` em cada um, o erro de ponto flutuante
 *     acumula. Quem precisa de `Number` converte na PRÓPRIA borda.
 *   - **`scrapPct` aplicado em CADA nível**, como já era.
 *   - **Ciclo detectado por CAMINHO**, não global: o mesmo componente pode
 *     aparecer em ramos diferentes da árvore (diamante) sem ser barrado; só o
 *     ciclo de verdade (A → B → A) para a recursão.
 *   - **Nada some em silêncio.** Ciclo, estouro de profundidade e BOM ativa
 *     ambígua entram na lista de inconsistências do retorno.
 *   - **Zero dependência de Prisma, Nest ou banco.** Recebe dados por injeção;
 *     quem carrega do banco é o serviço que embrulha este núcleo.
 *
 * Produto sem BOM ativa é matéria-prima (comprado): a recursão simplesmente
 * para ali. Isso é normal e NÃO é inconsistência.
 */

import { Prisma } from '@prisma/client';

type Decimal = Prisma.Decimal;
const D = Prisma.Decimal;

/** Profundidade máxima da árvore. Mesmo valor que o MRP já praticava. */
export const MAX_BOM_DEPTH = 10;

// ─── Contratos de entrada ───────────────────────────────────────────────────

/**
 * Valor numérico vindo do banco.
 *
 * O Prisma devolve `Decimal` para colunas `@db.Decimal`, mas aceitamos também
 * `string` e `number` porque é assim que os dados chegam em teste e em qualquer
 * chamador que monte a árvore à mão. A conversão para `Decimal` a partir de
 * string é EXATA — não há perda em aceitar as três formas, e há risco em supor
 * que sempre virá `Decimal`.
 */
export type ValorNumerico = Decimal | number | string;

/** Recorte mínimo de uma linha de BOM para efeito de explosão. */
export interface BomItemInput {
  /** `BomItem.id` — é ele que dá acesso ao `routingStepId` na #817. */
  id: string;
  componentId: string;
  quantity: ValorNumerico;
  scrapPct: ValorNumerico;
  /** #815 — operação do roteiro onde o componente é consumido. */
  routingStepId: string | null;
  unit?: string | null;
}

/** Recorte mínimo de uma versão de BOM. */
export interface BomVersionInput {
  id: string;
  productId: string;
  version: number;
  items: readonly BomItemInput[];
}

/** Uma linha do carrinho: "quero N deste produto". */
export interface CartLine {
  productId: string;
  quantity: Decimal | number | string;
}

// ─── Contratos de saída ─────────────────────────────────────────────────────

/**
 * Uma aresta da árvore: um pai consome um componente através de uma linha de
 * BOM. É a unidade de informação que o despacho por setor precisa.
 */
export interface LedgerEdge {
  parentProductId: string;
  bomVersionId: string;
  /** A linha de BOM que ligou pai e filho — carrega o `routingStepId`. */
  bomItemId: string;
  componentId: string;
  /** Profundidade: 1 = filho direto de um item do carrinho. */
  level: number;
  /** Quantidade unitária JÁ com refugo: `quantity * (1 + scrapPct/100)`. */
  quantityPerParent: Decimal;
  /** Quantidade absoluta, acumulada por toda a cadeia até a raiz. */
  quantity: Decimal;
  scrapPct: Decimal;
  routingStepId: string | null;
  unit: string | null;
  /**
   * Caminho de produtos da raiz até o pai, inclusive. Serve para depurar
   * ciclo e para a #817 saber de qual ramo a necessidade veio.
   */
  path: readonly string[];
}

/** Uma linha do carrinho, já normalizada. Nível 0 da árvore. */
export interface LedgerRoot {
  productId: string;
  quantity: Decimal;
  level: 0;
}

export type InconsistencyCode =
  /** Mais de uma BOM marcada como ativa para o mesmo produto (#981). */
  | 'AMBIGUOUS_ACTIVE_BOM'
  /** A árvore volta a um produto que já está no caminho atual. */
  | 'BOM_CYCLE'
  /** A árvore passou de `MAX_BOM_DEPTH` níveis e foi truncada. */
  | 'MAX_DEPTH_EXCEEDED'
  /** Linha de carrinho com quantidade ausente, zero, negativa ou não numérica. */
  | 'INVALID_CART_QUANTITY';

/** Um problema encontrado durante a explosão. Nunca some — sempre volta. */
export interface Inconsistency {
  code: InconsistencyCode;
  productId: string;
  /** Frase pronta, em português, para aparecer na tela sem tradução. */
  detail: string;
  /** Caminho da raiz até onde o problema apareceu, quando faz sentido. */
  path?: readonly string[];
}

export interface ExplosionResult {
  roots: LedgerRoot[];
  edges: LedgerEdge[];
  inconsistencies: Inconsistency[];
}

// ─── Seleção de BOM ativa (#981) ────────────────────────────────────────────

/**
 * Indexa as BOMs ativas por produto, de forma DETERMINÍSTICA.
 *
 * O bug da #981 mora aqui. O código anterior fazia
 * `new Map(activeBoms.map((b) => [b.productId, b]))` sobre um `findMany` SEM
 * `orderBy`: com duas versões ativas do mesmo produto, a segunda sobrescrevia a
 * primeira **em silêncio**, e qual delas vinha primeiro dependia da ordem em que
 * o Postgres devolvia as linhas — que sem `ORDER BY` não é garantida.
 *
 * O banco não protege contra esse estado: `@@unique([productId, version])`
 * garante unicidade de VERSÃO, não de ATIVA. A unicidade da ativa é procedural,
 * garantida só por quem passa pelo `bom.service.activate`. Importação, seed,
 * migration ou `UPDATE` direto furam a garantia — e as BOMs da GDR vieram de
 * importação.
 *
 * **Decisão de produto (Rafael, 04/08/2026): escolher de forma ordenada e
 * avisar, NÃO rejeitar.** Rejeitar faria um dado sujo em um único produto
 * derrubar o despacho da fábrica inteira. Mas o aviso tem de ser visível na
 * resposta, não um log que ninguém lê.
 *
 * Critério de desempate: **maior `version`** — a mais recente é a intenção mais
 * provável. Empate de versão é impossível pelo índice único do banco, mas ainda
 * assim o `id` desempata, para a função ser total e nunca depender da ordem de
 * entrada.
 */
export function selecionarBomsAtivas(versions: readonly BomVersionInput[]): {
  byProduct: Map<string, BomVersionInput>;
  inconsistencies: Inconsistency[];
} {
  const porProduto = new Map<string, BomVersionInput[]>();
  for (const v of versions) {
    const lista = porProduto.get(v.productId);
    if (lista) lista.push(v);
    else porProduto.set(v.productId, [v]);
  }

  const byProduct = new Map<string, BomVersionInput>();
  const inconsistencies: Inconsistency[] = [];

  for (const [productId, lista] of porProduto) {
    const ordenada = [...lista].sort(
      (a, b) => b.version - a.version || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const escolhida = ordenada[0];
    byProduct.set(productId, escolhida);

    if (ordenada.length > 1) {
      const versoes = ordenada.map((v) => v.version).join(', ');
      inconsistencies.push({
        code: 'AMBIGUOUS_ACTIVE_BOM',
        productId,
        detail:
          `O produto tem ${ordenada.length} versões de BOM marcadas como ativas ` +
          `(versões ${versoes}). Foi usada a versão ${escolhida.version}, a mais recente. ` +
          `Corrija a duplicidade — só uma versão deve ficar ativa.`,
      });
    }
  }

  return { byProduct, inconsistencies };
}

// ─── Explosão ───────────────────────────────────────────────────────────────

/** Construtor de `Decimal`. Ver `ExplodeOptions.DecimalClass`. */
export type DecimalCtor = new (valor: never) => Decimal;

export interface ExplodeOptions {
  /** Profundidade máxima. Padrão: `MAX_BOM_DEPTH`. */
  maxDepth?: number;
  /**
   * Classe usada para a aritmética. Padrão: `Prisma.Decimal` — é o que roda em
   * produção e ninguém precisa passar isto no uso normal.
   *
   * O ponto de extensão existe por causa dos testes: este repositório substitui
   * `@prisma/client` inteiro por um stub
   * (`src/__mocks__/generated/prisma`), cujo `Decimal` guarda um `number` por
   * dentro e portanto **reproduz o erro de ponto flutuante** que o `Decimal` de
   * verdade não tem. Sem poder injetar a classe real, seria impossível provar
   * em teste a exatidão que a #980 exige — e uma regressão que reintroduzisse
   * `Number()` no meio da cadeia passaria despercebida.
   */
  DecimalClass?: DecimalCtor;
}

/**
 * Explode um carrinho inteiro e devolve o ledger de arestas.
 *
 * Não consulta estoque, não grava nada, não sabe o que é setor. É aritmética
 * pura sobre a árvore.
 */
export function explodirCarrinho(
  cart: readonly CartLine[],
  byProduct: ReadonlyMap<string, BomVersionInput>,
  options: ExplodeOptions = {},
): ExplosionResult {
  const maxDepth = options.maxDepth ?? MAX_BOM_DEPTH;
  const Dec = options.DecimalClass ?? (D as unknown as DecimalCtor);

  const roots: LedgerRoot[] = [];
  const edges: LedgerEdge[] = [];
  const inconsistencies: Inconsistency[] = [];

  for (const linha of cart) {
    const qty = normalizarQuantidade(linha.quantity, Dec);
    if (qty === null) {
      inconsistencies.push({
        code: 'INVALID_CART_QUANTITY',
        productId: linha.productId,
        detail:
          `Quantidade inválida no carrinho (${String(linha.quantity)}). ` +
          `Informe um número maior que zero.`,
      });
      continue;
    }

    roots.push({ productId: linha.productId, quantity: qty, level: 0 });

    descer({
      productId: linha.productId,
      qty,
      level: 1,
      caminho: [linha.productId],
      byProduct,
      maxDepth,
      Dec,
      edges,
      inconsistencies,
    });
  }

  return { roots, edges, inconsistencies };
}

interface DescerArgs {
  productId: string;
  qty: Decimal;
  level: number;
  /** Produtos da raiz até `productId`, inclusive. É o detector de ciclo. */
  caminho: readonly string[];
  byProduct: ReadonlyMap<string, BomVersionInput>;
  maxDepth: number;
  Dec: DecimalCtor;
  edges: LedgerEdge[];
  inconsistencies: Inconsistency[];
}

function descer(args: DescerArgs): void {
  const { productId, qty, level, caminho, byProduct, maxDepth, Dec, edges, inconsistencies } = args;

  const bom = byProduct.get(productId);
  // Sem BOM ativa = matéria-prima / comprado. Fim do ramo, sem drama.
  if (!bom) return;

  if (level > maxDepth) {
    inconsistencies.push({
      code: 'MAX_DEPTH_EXCEEDED',
      productId,
      detail:
        `A árvore de materiais passou de ${maxDepth} níveis e foi truncada neste ponto. ` +
        `Os componentes abaixo deste produto NÃO entraram no cálculo.`,
      path: caminho,
    });
    return;
  }

  for (const item of bom.items) {
    const itemQty = new Dec(item.quantity as never);
    const scrapPct = new Dec(item.scrapPct as never);
    const fator = new Dec(1 as never).plus(scrapPct.div(100));
    const quantityPerParent = itemQty.mul(fator);
    const quantity = qty.mul(quantityPerParent);

    edges.push({
      parentProductId: productId,
      bomVersionId: bom.id,
      bomItemId: item.id,
      componentId: item.componentId,
      level,
      quantityPerParent,
      quantity,
      scrapPct,
      routingStepId: item.routingStepId,
      unit: item.unit ?? null,
      path: caminho,
    });

    // Ciclo é por CAMINHO: o componente já apareceu na linhagem deste ramo.
    if (caminho.includes(item.componentId)) {
      inconsistencies.push({
        code: 'BOM_CYCLE',
        productId: item.componentId,
        detail:
          `Ciclo na estrutura de produto: o item volta a aparecer dentro de si mesmo ` +
          `(${[...caminho, item.componentId].join(' → ')}). O ramo foi interrompido aqui.`,
        path: [...caminho, item.componentId],
      });
      continue;
    }

    descer({
      ...args,
      productId: item.componentId,
      qty: quantity,
      level: level + 1,
      caminho: [...caminho, item.componentId],
    });
  }
}

// ─── Projeção plana (o que o MRP consome) ───────────────────────────────────

export interface DemandaAgregada {
  grossQty: Decimal;
  /** Menor nível em que o produto apareceu — o mais alto na árvore. */
  level: number;
}

/**
 * Achata o ledger em "quanto de cada produto, no total".
 *
 * É a leitura que o MRP faz. Soma as quantidades e mantém o MENOR nível
 * encontrado, exatamente como o antigo `mergeDemand` fazia — o comportamento
 * observável do MRP não muda.
 *
 * As raízes (itens do carrinho) entram no nível 0, também como antes: o produto
 * final vira sugestão de PRODUÇÃO quando tem BOM.
 */
export function agregarPorProduto(result: ExplosionResult): Map<string, DemandaAgregada> {
  const mapa = new Map<string, DemandaAgregada>();

  const somar = (productId: string, qty: Decimal, level: number) => {
    const atual = mapa.get(productId);
    if (atual) {
      atual.grossQty = atual.grossQty.plus(qty);
      atual.level = Math.min(atual.level, level);
    } else {
      mapa.set(productId, { grossQty: qty, level });
    }
  };

  for (const raiz of result.roots) somar(raiz.productId, raiz.quantity, 0);
  for (const aresta of result.edges) somar(aresta.componentId, aresta.quantity, aresta.level);

  return mapa;
}

// ─── Utilitários ────────────────────────────────────────────────────────────

/**
 * Converte a quantidade do carrinho para `Decimal`, ou `null` se não servir.
 *
 * Rejeita zero e negativo: pedir "0 carretinhas" ou "-3" não é um cálculo
 * válido, é um erro de entrada — e é melhor aparecer como inconsistência
 * nomeada do que produzir um ledger vazio sem explicação.
 */
function normalizarQuantidade(valor: ValorNumerico, Dec: DecimalCtor): Decimal | null {
  let d: Decimal;
  try {
    // O `Decimal` real lança em entrada inválida...
    d = new Dec(valor as never);
  } catch {
    return null;
  }
  // ...enquanto o `DecimalMock` dos testes unitários devolve NaN em silêncio.
  // `toNumber()` + `Number.isFinite` cobre os dois; `isFinite()` do decimal.js
  // NÃO existe no mock e não pode ser usado aqui.
  if (!Number.isFinite(d.toNumber())) return null;
  if (d.lte(0)) return null;
  return d;
}
