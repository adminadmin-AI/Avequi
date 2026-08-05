/**
 * #980 — Testes do núcleo de explosão de BOM.
 *
 * O núcleo é puro: não conhece Prisma, Nest nem banco. Por isso estes testes
 * montam a árvore à mão e não usam mock de repositório — o que falhar aqui é
 * erro de aritmética ou de regra, nunca de encanamento.
 *
 * Atenção ao `DecimalMock`: nos testes unitários o `@prisma/client` é
 * substituído por um stub (`src/__mocks__/generated/prisma`), cujo `Decimal`
 * implementa só um subconjunto do decimal.js. Comparações aqui usam
 * `toNumber()`.
 */

import { Prisma } from '@prisma/client';
import {
  BomVersionInput,
  MAX_BOM_DEPTH,
  agregarPorProduto,
  explodirCarrinho,
  selecionarBomsAtivas,
} from './bom-explosion';

const D = Prisma.Decimal;

// ─── Auxiliares de montagem ─────────────────────────────────────────────────

let seqItem = 0;

function item(
  componentId: string,
  quantity: number | string,
  scrapPct: number | string = 0,
  routingStepId: string | null = null,
) {
  seqItem += 1;
  return { id: `bi-${seqItem}`, componentId, quantity, scrapPct, routingStepId, unit: 'UN' };
}

function bom(
  productId: string,
  items: ReturnType<typeof item>[],
  version = 1,
  id = `bom-${productId}-v${version}`,
): BomVersionInput {
  return { id, productId, version, items };
}

function indexar(versions: BomVersionInput[]) {
  return selecionarBomsAtivas(versions).byProduct;
}

beforeEach(() => {
  seqItem = 0;
});

// ─── selecionarBomsAtivas (#981) ────────────────────────────────────────────

describe('selecionarBomsAtivas', () => {
  it('indexa uma BOM por produto quando não há ambiguidade', () => {
    const { byProduct, inconsistencies } = selecionarBomsAtivas([
      bom('p-a', [item('p-b', 1)]),
      bom('p-b', [item('p-c', 1)]),
    ]);

    expect(byProduct.size).toBe(2);
    expect(byProduct.get('p-a')?.productId).toBe('p-a');
    expect(inconsistencies).toEqual([]);
  });

  it('com duas BOMs ativas escolhe a de MAIOR versão e denuncia a duplicidade', () => {
    const { byProduct, inconsistencies } = selecionarBomsAtivas([
      bom('p-a', [item('p-b', 1)], 1, 'bom-v1'),
      bom('p-a', [item('p-b', 99)], 3, 'bom-v3'),
      bom('p-a', [item('p-b', 50)], 2, 'bom-v2'),
    ]);

    expect(byProduct.get('p-a')?.id).toBe('bom-v3');

    expect(inconsistencies).toHaveLength(1);
    expect(inconsistencies[0].code).toBe('AMBIGUOUS_ACTIVE_BOM');
    expect(inconsistencies[0].productId).toBe('p-a');
    // A mensagem tem de servir para a tela, sem tradução.
    expect(inconsistencies[0].detail).toContain('3 versões');
    expect(inconsistencies[0].detail).toContain('versão 3');
  });

  it('é determinística: a ordem de entrada não muda a escolha (o bug da #981)', () => {
    const a = bom('p-a', [item('p-b', 1)], 1, 'bom-v1');
    const b = bom('p-a', [item('p-b', 2)], 2, 'bom-v2');

    const primeira = selecionarBomsAtivas([a, b]).byProduct.get('p-a')?.id;
    const segunda = selecionarBomsAtivas([b, a]).byProduct.get('p-a')?.id;

    expect(primeira).toBe('bom-v2');
    expect(segunda).toBe('bom-v2');
  });

  it('não denuncia nada quando a lista está vazia', () => {
    const { byProduct, inconsistencies } = selecionarBomsAtivas([]);
    expect(byProduct.size).toBe(0);
    expect(inconsistencies).toEqual([]);
  });
});

// ─── explodirCarrinho ───────────────────────────────────────────────────────

describe('explodirCarrinho', () => {
  it('explode BOM multinível: modelo → conjunto → peça', () => {
    // 10 modelos → 2 conjuntos cada → 3 peças por conjunto
    const byProduct = indexar([
      bom('modelo', [item('conjunto', 2)]),
      bom('conjunto', [item('peca', 3)]),
    ]);

    const r = explodirCarrinho([{ productId: 'modelo', quantity: 10 }], byProduct);

    expect(r.inconsistencies).toEqual([]);
    expect(r.roots).toHaveLength(1);
    expect(r.roots[0].quantity.toNumber()).toBe(10);

    const conjunto = r.edges.find((e) => e.componentId === 'conjunto')!;
    const peca = r.edges.find((e) => e.componentId === 'peca')!;

    expect(conjunto.level).toBe(1);
    expect(conjunto.quantity.toNumber()).toBe(20);
    expect(peca.level).toBe(2);
    expect(peca.quantity.toNumber()).toBe(60);
    expect(peca.parentProductId).toBe('conjunto');
  });

  it('aplica scrapPct em CADA nível', () => {
    // 100 × (2 × 1.10) = 220 ; 220 × (3 × 1.20) = 792
    const byProduct = indexar([
      bom('modelo', [item('conjunto', 2, 10)]),
      bom('conjunto', [item('peca', 3, 20)]),
    ]);

    const r = explodirCarrinho([{ productId: 'modelo', quantity: 100 }], byProduct);

    // `toBeCloseTo`, e não `toBe`, POR CAUSA DO MOCK: o `DecimalMock` deste
    // repositório guarda um `number` por dentro, então reproduz o erro de ponto
    // flutuante que o `Decimal` de verdade não tem (dá 220.00000000000003).
    // A exatidão está provada no bloco "precisão decimal", abaixo, contra o
    // Decimal real.
    expect(r.edges.find((e) => e.componentId === 'conjunto')!.quantity.toNumber()).toBeCloseTo(
      220,
      6,
    );
    expect(r.edges.find((e) => e.componentId === 'peca')!.quantity.toNumber()).toBeCloseTo(792, 6);
  });

  it('preserva bomItemId e routingStepId na aresta — é o que a #817 consome', () => {
    const byProduct = indexar([bom('modelo', [item('peca', 4, 0, 'step-solda-1')])]);

    const r = explodirCarrinho([{ productId: 'modelo', quantity: 1 }], byProduct);

    expect(r.edges).toHaveLength(1);
    expect(r.edges[0].bomItemId).toBe('bi-1');
    expect(r.edges[0].routingStepId).toBe('step-solda-1');
    expect(r.edges[0].bomVersionId).toBe('bom-modelo-v1');
    expect(r.edges[0].unit).toBe('UN');
  });

  it('registra quantityPerParent separada da quantidade acumulada', () => {
    const byProduct = indexar([bom('modelo', [item('peca', 2, 50)])]);

    const r = explodirCarrinho([{ productId: 'modelo', quantity: 7 }], byProduct);

    // 2 × 1.5 = 3 por pai ; 7 × 3 = 21 no total
    expect(r.edges[0].quantityPerParent.toNumber()).toBe(3);
    expect(r.edges[0].quantity.toNumber()).toBe(21);
    expect(r.edges[0].scrapPct.toNumber()).toBe(50);
  });

  it('produto sem BOM ativa é matéria-prima: o ramo para, sem inconsistência', () => {
    const byProduct = indexar([bom('modelo', [item('comprado', 5)])]);

    const r = explodirCarrinho([{ productId: 'modelo', quantity: 1 }], byProduct);

    expect(r.edges).toHaveLength(1);
    expect(r.inconsistencies).toEqual([]);
  });

  it('carrinho vazio devolve resultado vazio, sem erro', () => {
    const r = explodirCarrinho([], indexar([bom('modelo', [item('peca', 1)])]));

    expect(r.roots).toEqual([]);
    expect(r.edges).toEqual([]);
    expect(r.inconsistencies).toEqual([]);
  });

  it('soma as duas linhas quando o mesmo produto aparece duas vezes no carrinho', () => {
    const byProduct = indexar([bom('modelo', [item('peca', 2)])]);

    const r = explodirCarrinho(
      [
        { productId: 'modelo', quantity: 3 },
        { productId: 'modelo', quantity: 4 },
      ],
      byProduct,
    );

    expect(r.roots).toHaveLength(2);
    expect(agregarPorProduto(r).get('peca')!.grossQty.toNumber()).toBe(14);
  });

  describe('quantidade inválida no carrinho', () => {
    it.each([
      ['zero', 0],
      ['negativa', -5],
      ['texto', 'abc'],
    ])('rejeita quantidade %s e explica o motivo', (_rotulo, quantity) => {
      const byProduct = indexar([bom('modelo', [item('peca', 1)])]);

      const r = explodirCarrinho(
        [{ productId: 'modelo', quantity: quantity as never }],
        byProduct,
      );

      expect(r.roots).toEqual([]);
      expect(r.edges).toEqual([]);
      expect(r.inconsistencies).toHaveLength(1);
      expect(r.inconsistencies[0].code).toBe('INVALID_CART_QUANTITY');
      expect(r.inconsistencies[0].productId).toBe('modelo');
    });

    it('uma linha inválida não derruba as outras', () => {
      const byProduct = indexar([bom('modelo', [item('peca', 1)])]);

      const r = explodirCarrinho(
        [
          { productId: 'modelo', quantity: 0 },
          { productId: 'modelo', quantity: 5 },
        ],
        byProduct,
      );

      expect(r.roots).toHaveLength(1);
      expect(r.edges).toHaveLength(1);
      expect(r.inconsistencies).toHaveLength(1);
    });
  });

  describe('ciclo de BOM', () => {
    it('não trava e denuncia o ciclo', () => {
      const byProduct = indexar([
        bom('p-a', [item('p-b', 1)]),
        bom('p-b', [item('p-a', 1)]),
      ]);

      const r = explodirCarrinho([{ productId: 'p-a', quantity: 1 }], byProduct);

      const ciclo = r.inconsistencies.filter((i) => i.code === 'BOM_CYCLE');
      expect(ciclo).toHaveLength(1);
      expect(ciclo[0].productId).toBe('p-a');
      expect(ciclo[0].path).toEqual(['p-a', 'p-b', 'p-a']);
      // A aresta que fecha o ciclo é registrada; o que para é a descida.
      expect(r.edges).toHaveLength(2);
    });

    it('DIAMANTE não é ciclo: o mesmo componente em dois ramos é permitido', () => {
      // topo → esquerda → comum ; topo → direita → comum
      const byProduct = indexar([
        bom('topo', [item('esquerda', 1), item('direita', 1)]),
        bom('esquerda', [item('comum', 2)]),
        bom('direita', [item('comum', 3)]),
        bom('comum', [item('folha', 10)]),
      ]);

      const r = explodirCarrinho([{ productId: 'topo', quantity: 1 }], byProduct);

      expect(r.inconsistencies).toEqual([]);
      // 'comum' aparece nos dois ramos, e cada um desce até a folha
      expect(r.edges.filter((e) => e.componentId === 'comum')).toHaveLength(2);
      expect(r.edges.filter((e) => e.componentId === 'folha')).toHaveLength(2);
      expect(agregarPorProduto(r).get('folha')!.grossQty.toNumber()).toBe(50);
    });
  });

  describe('profundidade máxima', () => {
    it('trunca e denuncia quando a árvore passa do limite', () => {
      // Cadeia p0 → p1 → ... → p20, mais funda que MAX_BOM_DEPTH
      const versions: BomVersionInput[] = [];
      for (let i = 0; i < 20; i++) versions.push(bom(`p${i}`, [item(`p${i + 1}`, 1)]));

      const r = explodirCarrinho([{ productId: 'p0', quantity: 1 }], indexar(versions));

      const estouro = r.inconsistencies.filter((i) => i.code === 'MAX_DEPTH_EXCEEDED');
      expect(estouro.length).toBeGreaterThan(0);
      expect(r.edges).toHaveLength(MAX_BOM_DEPTH);
      // O corte tem de dizer que os componentes abaixo ficaram de fora.
      expect(estouro[0].detail).toContain('NÃO entraram no cálculo');
    });

    it('respeita um limite menor passado por opção', () => {
      const versions: BomVersionInput[] = [];
      for (let i = 0; i < 5; i++) versions.push(bom(`p${i}`, [item(`p${i + 1}`, 1)]));

      const r = explodirCarrinho([{ productId: 'p0', quantity: 1 }], indexar(versions), {
        maxDepth: 2,
      });

      expect(r.edges).toHaveLength(2);
      expect(r.inconsistencies.some((i) => i.code === 'MAX_DEPTH_EXCEEDED')).toBe(true);
    });
  });

  it('aceita quantidade como Decimal, número ou string, com o mesmo resultado', () => {
    const byProduct = indexar([bom('modelo', [item('peca', '2.5', '0')])]);

    const comNumero = explodirCarrinho([{ productId: 'modelo', quantity: 4 }], byProduct);
    const comTexto = explodirCarrinho([{ productId: 'modelo', quantity: '4' }], byProduct);
    const comDecimal = explodirCarrinho([{ productId: 'modelo', quantity: new D(4) }], byProduct);

    expect(comNumero.edges[0].quantity.toNumber()).toBe(10);
    expect(comTexto.edges[0].quantity.toNumber()).toBe(10);
    expect(comDecimal.edges[0].quantity.toNumber()).toBe(10);
  });
});

// ─── Precisão decimal (contra o Decimal REAL) ───────────────────────────────

/**
 * Este bloco é a razão de ser do requisito de `Decimal` da #980/#817.
 *
 * O `moduleNameMapper` do jest só intercepta `^@prisma/client$` — o subcaminho
 * `@prisma/client/runtime/library` passa direto e entrega o `Decimal` de
 * verdade (decimal.js). Injetando essa classe via `options.DecimalClass`, a
 * explosão roda com a MESMA aritmética que roda em produção, e dá para provar
 * aqui que a cadeia de multiplicações fecha EXATA.
 *
 * Se alguém reintroduzir `Number()` no meio da explosão, este bloco quebra.
 */
describe('precisão decimal (Decimal real, sem o mock)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Decimal: DecimalReal } = require('@prisma/client/runtime/library');

  const dec = (v: string | number) => new DecimalReal(v);

  it('cadeia de 3 níveis com refugo fecha exata, sem resíduo de ponto flutuante', () => {
    const byProduct = indexar([
      {
        id: 'b1',
        productId: 'modelo',
        version: 1,
        items: [
          {
            id: 'i1',
            componentId: 'conjunto',
            quantity: dec('2'),
            scrapPct: dec('10'),
            routingStepId: null,
            unit: 'UN',
          },
        ],
      },
      {
        id: 'b2',
        productId: 'conjunto',
        version: 1,
        items: [
          {
            id: 'i2',
            componentId: 'peca',
            quantity: dec('3'),
            scrapPct: dec('20'),
            routingStepId: null,
            unit: 'UN',
          },
        ],
      },
    ]);

    const r = explodirCarrinho([{ productId: 'modelo', quantity: dec('100') }], byProduct, {
      DecimalClass: DecimalReal,
    });

    const conjunto = r.edges.find((e) => e.componentId === 'conjunto')!;
    const peca = r.edges.find((e) => e.componentId === 'peca')!;

    // Em `Number` puro isto daria 220.00000000000003 e 792.0000000000002.
    expect(conjunto.quantity.toString()).toBe('220');
    expect(peca.quantity.toString()).toBe('792');

    // E a soma da projeção também tem de fechar exata.
    expect(agregarPorProduto(r).get('peca')!.grossQty.toString()).toBe('792');
  });

  it('a aritmética em Number, para comparação, NÃO fecha — é o problema que o Decimal resolve', () => {
    // Documenta o motivo do requisito: mesma conta, feita como o código antigo
    // fazia, com resíduo.
    expect(100 * (2 * (1 + 10 / 100))).not.toBe(220);
  });
});

// ─── agregarPorProduto (a projeção que o MRP consome) ───────────────────────

describe('agregarPorProduto', () => {
  it('soma as quantidades e mantém o MENOR nível encontrado', () => {
    // 'peca' aparece no nível 1 (direto do modelo) e no nível 2 (via conjunto)
    const byProduct = indexar([
      bom('modelo', [item('conjunto', 2), item('peca', 5)]),
      bom('conjunto', [item('peca', 3)]),
    ]);

    const mapa = agregarPorProduto(
      explodirCarrinho([{ productId: 'modelo', quantity: 10 }], byProduct),
    );

    // 10×5 = 50 direto + (10×2)×3 = 60 via conjunto
    expect(mapa.get('peca')!.grossQty.toNumber()).toBe(110);
    expect(mapa.get('peca')!.level).toBe(1);
  });

  it('coloca os itens do carrinho no nível 0', () => {
    const byProduct = indexar([bom('modelo', [item('peca', 1)])]);

    const mapa = agregarPorProduto(
      explodirCarrinho([{ productId: 'modelo', quantity: 3 }], byProduct),
    );

    expect(mapa.get('modelo')!.level).toBe(0);
    expect(mapa.get('modelo')!.grossQty.toNumber()).toBe(3);
  });

  it('devolve mapa vazio para resultado vazio', () => {
    expect(agregarPorProduto({ roots: [], edges: [], inconsistencies: [] }).size).toBe(0);
  });
});
