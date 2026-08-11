/**
 * #817 — Despacho por setor: OS e OC por centro de trabalho, a partir de um
 * carrinho de modelos.
 *
 * A GDR Reboques fabrica carretinhas numa fábrica dividida em setores. Existe
 * hoje uma ferramenta interna em Streamlit que, dado um pedido ("50 carretinhas
 * do MOD-CAR-003"), imprime uma Ordem de Serviço por setor. O ERP sabia gerar
 * Ordem de Produção POR PRODUTO, mas não sabia dizer que a Solda 1 executa
 * estas peças e a Solda 2 aquelas. Este serviço entrega essa capacidade.
 *
 * Três propriedades que definem o desenho:
 *
 *   1. **É explosão pura de BOM.** Não consulta saldo de estoque em momento
 *      nenhum. Por isso pôde ser entregue ANTES de resolver inventário, que é o
 *      problema difícil e demorado de chão de fábrica.
 *   2. **A demanda é avulsa.** O MRP exige `SalesOrder` confirmada ou
 *      `DemandForecast`; aqui o carrinho chega direto, como simulação.
 *   3. **SOMENTE LEITURA.** Nenhum caminho deste arquivo escreve no banco: nem
 *      `MrpRun`, nem Ordem de Produção, nem `AuditLog` de escrita. Uma consulta
 *      que grava é uma armadilha — quem simula um pedido não espera efeito.
 *
 * A aritmética da árvore não mora aqui: vem do `BomExplosionService` (#980), que
 * o MRP também usa. Uma fonte de verdade para explodir BOM, duas leituras.
 * Deste serviço é o que o MRP não precisa: resolver ROTEIRO — qual operação, em
 * qual centro de trabalho, recebe cada coisa.
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { BomExplosionService } from '../../common/production/bom-explosion.service';
import { agregarPorProduto, LedgerEdge } from '../../common/production/bom-explosion';
import { PrismaService } from '../../prisma/prisma.service';
import { DispatchRequestDto } from './dto/dispatch.dto';
import {
  DispatchCollectItem,
  DispatchMarket,
  DispatchOperation,
  DispatchPendency,
  DispatchProductRef,
  DispatchResult,
  DispatchSourceType,
  DispatchWorkCenter,
  DispatchWorkCenterRef,
} from './dispatch.types';

/**
 * Tipos de produto que a fábrica PRODUZ. Um produto destes sem BOM ativa é
 * cadastro faltando (`MISSING_ACTIVE_BOM`); um `RAW_MATERIAL` ou `COMPONENT`
 * sem BOM é apenas uma peça comprada, e isso é normal.
 */
const TIPOS_FABRICAVEIS: ProductType[] = [ProductType.FINISHED_GOOD, ProductType.SEMI_FINISHED];

/** Casas decimais da resposta — mesma precisão de `BomItem.quantity` no banco. */
const CASAS_DECIMAIS = 4;

/**
 * #1058 passo 2 — exceção da MONTAGEM na resolução de mercado.
 *
 * Regra geral: a linha de OC passa pelo mercado padrão do centro CONSUMIDOR
 * (`WorkCenter.supplyMarketId`). A Montagem é a única que compra de TRÊS
 * mercados, conforme a natureza do item (decisão do Rafael, 11/08/2026):
 * comprados vêm do Almoxarifado; peças da marcenaria vêm do mercado da
 * marcenaria; o resto vem do Mercado Montagem Metal (o padrão dela).
 *
 * Os códigos são do cadastro da GDR. Se um dia outro tenant precisar do
 * conceito, isto vira tabela de regras (WorkCenterSupplyRule) — por ora,
 * constante documentada é mais honesto que uma abstração sem segundo caso.
 */
const MERCADO_MONTAGEM_METAL = 'SET-MER-006';
const MERCADO_MARCENARIA = 'SET-MER-007';
const MERCADO_ALMOXARIFADO = 'SET-MER-008';

interface PassoDeRoteiro {
  id: string;
  productId: string;
  stepOrder: number;
  name: string;
  workCenterId: string | null;
  workCenterRef: DispatchWorkCenterRef | null;
}

interface InfoProduto {
  sku: string;
  name: string;
  unit: string;
  type: ProductType;
}

/** Linha de OC em construção, antes de virar resposta. */
interface OcEmMontagem {
  componentId: string;
  quantity: Prisma.Decimal;
  bomItemIds: string[];
}

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bomExplosion: BomExplosionService,
  ) {}

  /**
   * Monta o despacho da fábrica para um carrinho.
   *
   * `companyId` vem SEMPRE do JWT — o DTO nem aceita o campo.
   */
  async dispatch(companyId: string, dto: DispatchRequestDto): Promise<DispatchResult> {
    const itens = dto.items ?? [];

    // Carrinho vazio é pedido válido, não erro: devolve despacho vazio.
    if (itens.length === 0) {
      return { cart: [], workCenters: [], markets: [], pendencies: [], inconsistencies: [] };
    }

    await this.garantirProdutosDaEmpresa(
      companyId,
      itens.map((i) => i.productId),
    );

    const explosao = await this.bomExplosion.explodir(companyId, itens);

    // Todo produto que aparece em qualquer ponto da árvore.
    const envolvidos = new Set<string>();
    for (const raiz of explosao.roots) envolvidos.add(raiz.productId);
    for (const aresta of explosao.edges) {
      envolvidos.add(aresta.parentProductId);
      envolvidos.add(aresta.componentId);
    }

    const [produtos, passos, centrosDaEmpresa] = await Promise.all([
      this.carregarProdutos(companyId, envolvidos),
      this.carregarRoteiros(companyId, envolvidos),
      this.carregarCentrosComMercado(companyId),
    ]);

    const passosPorProduto = new Map<string, PassoDeRoteiro[]>();
    const passoPorId = new Map<string, PassoDeRoteiro>();
    for (const passo of passos) {
      passoPorId.set(passo.id, passo);
      const lista = passosPorProduto.get(passo.productId);
      if (lista) lista.push(passo);
      else passosPorProduto.set(passo.productId, [passo]);
    }

    // Quantidade total de cada produto, somando todos os ramos da árvore.
    // É a MESMA projeção que o MRP consome — nada de recalcular por fora.
    const agregado = agregarPorProduto(explosao);
    const quantidadeDe = (productId: string): Prisma.Decimal =>
      agregado.get(productId)?.grossQty ?? new Prisma.Decimal(0);

    const pendencies: DispatchPendency[] = [];
    const refDe = (productId: string) => this.refProduto(productId, produtos);

    // ── 1. Alocar cada aresta da BOM à operação que a consome ────────────────
    const ocPorPasso = new Map<string, Map<string, OcEmMontagem>>();
    const naoAlocadas = new Map<string, { edge: LedgerEdge; quantity: Prisma.Decimal }>();

    for (const aresta of explosao.edges) {
      if (!aresta.routingStepId) {
        // `BomItem` sem operação: o componente não tem onde ser entregue.
        // Agrupado por (pai, componente) porque é assim que se corrige o
        // cadastro — a pessoa precisa saber em QUAL BOM abrir a linha.
        const chave = `${aresta.parentProductId}::${aresta.componentId}`;
        const atual = naoAlocadas.get(chave);
        if (atual) atual.quantity = atual.quantity.plus(aresta.quantity);
        else naoAlocadas.set(chave, { edge: aresta, quantity: aresta.quantity });
        continue;
      }

      const passo = passoPorId.get(aresta.routingStepId);
      // O passo tem de existir NESTA empresa e ser do produto dono da BOM.
      // A FK garante existência, não coerência de produto nem de empresa.
      if (!passo || passo.productId !== aresta.parentProductId) {
        pendencies.push({
          code: 'ROUTING_STEP_MISMATCH',
          ...refDe(aresta.componentId),
          quantity: this.formatar(aresta.quantity),
          routingStepId: aresta.routingStepId,
          detail:
            `A linha de BOM aponta para uma operação que não pertence ao produto ` +
            `${refDe(aresta.parentProductId).sku}. A alocação não pôde ser honrada e o ` +
            `componente NÃO entrou em nenhuma OC. Corrija a alocação na BOM.`,
        });
        continue;
      }

      const porComponente = ocPorPasso.get(passo.id) ?? new Map<string, OcEmMontagem>();
      const atual = porComponente.get(aresta.componentId);
      if (atual) {
        atual.quantity = atual.quantity.plus(aresta.quantity);
        if (!atual.bomItemIds.includes(aresta.bomItemId)) atual.bomItemIds.push(aresta.bomItemId);
      } else {
        porComponente.set(aresta.componentId, {
          componentId: aresta.componentId,
          quantity: aresta.quantity,
          bomItemIds: [aresta.bomItemId],
        });
      }
      ocPorPasso.set(passo.id, porComponente);
    }

    for (const { edge, quantity } of naoAlocadas.values()) {
      pendencies.push({
        code: 'UNALLOCATED_COMPONENT',
        ...refDe(edge.componentId),
        quantity: this.formatar(quantity),
        detail:
          `O componente está na BOM de ${refDe(edge.parentProductId).sku} mas não foi alocado ` +
          `a nenhuma operação do roteiro. Sem alocação não há setor que o receba, então ele ` +
          `NÃO entrou em nenhuma OC.`,
      });
    }

    // ── 2. Montar as operações de cada produto fabricado ─────────────────────
    const operacoesPorCentro = new Map<string, DispatchOperation[]>();
    const centros = new Map<string, DispatchWorkCenterRef>();

    // #1058 passo 2 — agregação da visão do operador de mercado, em Decimal
    // (formatar só na borda). Chaves compostas com '::' (ids são cuid, sem ':').
    const mercadosUsados = new Map<string, DispatchWorkCenterRef>();
    const entradaMercado = new Map<
      string,
      { marketId: string; productId: string; from: DispatchWorkCenterRef | null; sourceType: DispatchSourceType; qty: Prisma.Decimal }
    >();
    const saidaMercado = new Map<
      string,
      { marketId: string; productId: string; to: DispatchWorkCenterRef; qty: Prisma.Decimal }
    >();

    const registrarNoMercado = (
      market: DispatchWorkCenterRef,
      productId: string,
      qty: Prisma.Decimal,
      from: DispatchWorkCenterRef | null,
      sourceType: DispatchSourceType,
      to: DispatchWorkCenterRef,
    ): void => {
      mercadosUsados.set(market.workCenterId, market);
      const kIn = `${market.workCenterId}::${from?.workCenterId ?? 'EXT'}::${productId}`;
      const eIn = entradaMercado.get(kIn);
      if (eIn) eIn.qty = eIn.qty.plus(qty);
      else entradaMercado.set(kIn, { marketId: market.workCenterId, productId, from, sourceType, qty });
      const kOut = `${market.workCenterId}::${to.workCenterId}::${productId}`;
      const eOut = saidaMercado.get(kOut);
      if (eOut) eOut.qty = eOut.qty.plus(qty);
      else saidaMercado.set(kOut, { marketId: market.workCenterId, productId, to, qty });
    };

    for (const productId of [...envolvidos].sort()) {
      const info = produtos.get(productId);
      const temBom = explosao.byProduct.has(productId);

      if (!temBom) {
        // Produto sem BOM ativa: matéria-prima/comprado é o caso normal e não
        // gera pendência. Já um acabado ou semiacabado sem BOM é cadastro
        // faltando — a fábrica não sabe do que ele é feito.
        if (info && TIPOS_FABRICAVEIS.includes(info.type)) {
          pendencies.push({
            code: 'MISSING_ACTIVE_BOM',
            ...refDe(productId),
            quantity: this.formatar(quantidadeDe(productId)),
            detail:
              `O produto é do tipo fabricável mas não tem BOM ativa. Sem estrutura não há o que ` +
              `explodir, então nada abaixo dele entrou no despacho.`,
          });
        }
        continue;
      }

      const passosDoProduto = passosPorProduto.get(productId) ?? [];
      if (passosDoProduto.length === 0) {
        pendencies.push({
          code: 'MISSING_ROUTING',
          ...refDe(productId),
          quantity: this.formatar(quantidadeDe(productId)),
          detail:
            `O item é fabricado mas não tem nenhuma operação de roteiro cadastrada. Sem roteiro ` +
            `não há setor que o produza, então ele não aparece em nenhuma OS.`,
        });
        continue;
      }

      const quantidade = quantidadeDe(productId);

      for (let i = 0; i < passosDoProduto.length; i++) {
        const passo = passosDoProduto[i];
        const componentes = ocPorPasso.get(passo.id);

        if (!passo.workCenterId || !passo.workCenterRef) {
          // Sem centro de trabalho a operação não pode ser agrupada. Em vez de
          // inventar um setor sintético, a operação vira pendência — e o texto
          // diz quantos componentes ficaram de fora junto com ela, para o
          // tamanho do problema não ficar escondido.
          const qtdComponentes = componentes?.size ?? 0;
          pendencies.push({
            code: 'MISSING_WORK_CENTER',
            ...refDe(productId),
            quantity: this.formatar(quantidade),
            routingStepId: passo.id,
            detail:
              `A operação ${passo.stepOrder} (${passo.name}) não aponta para nenhum centro de ` +
              `trabalho. A OS desta operação` +
              (qtdComponentes > 0
                ? ` e os ${qtdComponentes} item(ns) da OC dela`
                : '') +
              ` não foram despachados. Vincule um centro de trabalho ao passo do roteiro.`,
          });
          continue;
        }

        const oc: DispatchCollectItem[] = [];

        // (a) O próprio item, vindo da operação ANTERIOR do seu roteiro.
        // Não é `BomItem` — um conjunto não é componente de si mesmo. Sem isto
        // a OC da Galvanização sairia vazia.
        if (i > 0) {
          const anterior = passosDoProduto[i - 1];
          const market = this.resolverMercado(
            passo.workCenterId,
            anterior.workCenterRef ? 'WORK_CENTER' : 'UNDEFINED',
            anterior.workCenterRef,
            centrosDaEmpresa,
          );
          if (market) {
            registrarNoMercado(
              market,
              productId,
              quantidade,
              anterior.workCenterRef,
              anterior.workCenterRef ? 'WORK_CENTER' : 'UNDEFINED',
              passo.workCenterRef,
            );
          }
          oc.push({
            ...refDe(productId),
            quantity: this.formatar(quantidade),
            sourceType: anterior.workCenterRef ? 'WORK_CENTER' : 'UNDEFINED',
            originKind: 'PREVIOUS_OPERATION',
            market,
            fromWorkCenter: anterior.workCenterRef,
            fromRoutingStepId: anterior.id,
            bomItemIds: [],
          });
        }

        // (b) Componentes da BOM alocados a ESTA operação.
        if (componentes) {
          const ordenados = [...componentes.values()].sort((a, b) =>
            refDe(a.componentId).sku.localeCompare(refDe(b.componentId).sku),
          );
          for (const c of ordenados) {
            const origem = this.origemDoComponente(c.componentId, passosPorProduto);
            const market = this.resolverMercado(
              passo.workCenterId,
              origem.sourceType,
              origem.fromWorkCenter,
              centrosDaEmpresa,
            );
            if (market) {
              registrarNoMercado(
                market,
                c.componentId,
                c.quantity,
                origem.fromWorkCenter,
                origem.sourceType,
                passo.workCenterRef,
              );
            }
            oc.push({
              ...refDe(c.componentId),
              quantity: this.formatar(c.quantity),
              sourceType: origem.sourceType,
              originKind: 'BOM_COMPONENT',
              market,
              fromWorkCenter: origem.fromWorkCenter,
              fromRoutingStepId: origem.fromRoutingStepId,
              bomItemIds: c.bomItemIds,
            });
          }
        }

        centros.set(passo.workCenterId, passo.workCenterRef);
        const lista = operacoesPorCentro.get(passo.workCenterId) ?? [];
        lista.push({
          routingStepId: passo.id,
          stepOrder: passo.stepOrder,
          stepName: passo.name,
          isFirstStep: i === 0,
          os: { ...refDe(productId), quantity: this.formatar(quantidade) },
          oc,
        });
        operacoesPorCentro.set(passo.workCenterId, lista);
      }
    }

    // ── 3. Ordenação estável, para a resposta não dançar entre chamadas ──────
    const workCenters: DispatchWorkCenter[] = [...centros.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((centro) => ({
        ...centro,
        operations: (operacoesPorCentro.get(centro.workCenterId) ?? []).sort(
          (a, b) => a.os.sku.localeCompare(b.os.sku) || a.stepOrder - b.stepOrder,
        ),
      }));

    pendencies.sort((a, b) => a.code.localeCompare(b.code) || a.sku.localeCompare(b.sku));

    // #1058 passo 2 — a visão do operador de mercado, ordenada de forma estável.
    const markets: DispatchMarket[] = [...mercadosUsados.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((mercado) => ({
        ...mercado,
        inbound: [...entradaMercado.values()]
          .filter((e) => e.marketId === mercado.workCenterId)
          .sort(
            (a, b) =>
              refDe(a.productId).sku.localeCompare(refDe(b.productId).sku) ||
              (a.from?.code ?? '').localeCompare(b.from?.code ?? ''),
          )
          .map((e) => ({
            ...refDe(e.productId),
            quantity: this.formatar(e.qty),
            sourceType: e.sourceType,
            from: e.from,
          })),
        outbound: [...saidaMercado.values()]
          .filter((s) => s.marketId === mercado.workCenterId)
          .sort(
            (a, b) =>
              a.to.code.localeCompare(b.to.code) ||
              refDe(a.productId).sku.localeCompare(refDe(b.productId).sku),
          )
          .map((s) => ({
            ...refDe(s.productId),
            quantity: this.formatar(s.qty),
            toWorkCenter: s.to,
          })),
      }));

    const cart = explosao.roots.map((raiz) => ({
      ...refDe(raiz.productId),
      quantity: this.formatar(raiz.quantity),
    }));

    return { cart, workCenters, markets, pendencies, inconsistencies: explosao.inconsistencies };
  }

  // ─── Auxiliares ───────────────────────────────────────────────────────────

  /**
   * Recusa o carrinho se algum produto não for desta empresa.
   *
   * Silenciar isso seria pior que o erro: o carrinho voltaria vazio e o usuário
   * concluiria que o produto não tem estrutura, quando na verdade ele é de
   * outro tenant.
   */
  private async garantirProdutosDaEmpresa(companyId: string, productIds: string[]): Promise<void> {
    const unicos = [...new Set(productIds)];
    const encontrados = await this.prisma.product.findMany({
      where: { companyId, id: { in: unicos } },
      select: { id: true },
    });

    if (encontrados.length !== unicos.length) {
      const achados = new Set(encontrados.map((p) => p.id));
      const faltando = unicos.filter((id) => !achados.has(id));
      throw new BadRequestException(
        `Produto não encontrado nesta empresa: ${faltando.join(', ')}`,
      );
    }
  }

  private async carregarProdutos(
    companyId: string,
    ids: ReadonlySet<string>,
  ): Promise<Map<string, InfoProduto>> {
    const produtos = await this.prisma.product.findMany({
      where: { companyId, id: { in: [...ids] } },
      select: { id: true, sku: true, name: true, unit: true, type: true },
    });

    return new Map(
      produtos.map((p) => [p.id, { sku: p.sku, name: p.name, unit: p.unit, type: p.type }]),
    );
  }

  private async carregarRoteiros(
    companyId: string,
    ids: ReadonlySet<string>,
  ): Promise<PassoDeRoteiro[]> {
    const passos = await this.prisma.routingStep.findMany({
      where: { companyId, productId: { in: [...ids] } },
      orderBy: [{ productId: 'asc' }, { stepOrder: 'asc' }],
      select: {
        id: true,
        productId: true,
        stepOrder: true,
        name: true,
        workCenterId: true,
        workCenterRef: { select: { id: true, code: true, name: true } },
      },
    });

    return passos.map((p) => ({
      id: p.id,
      productId: p.productId,
      stepOrder: p.stepOrder,
      name: p.name,
      workCenterId: p.workCenterId,
      workCenterRef: p.workCenterRef
        ? { workCenterId: p.workCenterRef.id, code: p.workCenterRef.code, name: p.workCenterRef.name }
        : null,
    }));
  }

  /**
   * De onde vem um componente que a operação precisa receber.
   *
   * Um item fabricado chega pronto da ÚLTIMA operação do próprio roteiro — é
   * ali que ele fica pronto. Um item sem roteiro é comprado ou vem do estoque.
   * E um item com roteiro cujo último passo não tem centro de trabalho não pode
   * ter origem afirmada: vira `UNDEFINED` em vez de virar chute.
   */
  private origemDoComponente(
    componentId: string,
    passosPorProduto: ReadonlyMap<string, PassoDeRoteiro[]>,
  ): {
    sourceType: DispatchSourceType;
    fromWorkCenter: DispatchWorkCenterRef | null;
    fromRoutingStepId: string | null;
  } {
    const passos = passosPorProduto.get(componentId);
    if (!passos || passos.length === 0) {
      return { sourceType: 'EXTERNAL_OR_STOCK', fromWorkCenter: null, fromRoutingStepId: null };
    }

    const ultimo = passos[passos.length - 1];
    if (!ultimo.workCenterRef) {
      return { sourceType: 'UNDEFINED', fromWorkCenter: null, fromRoutingStepId: ultimo.id };
    }

    return {
      sourceType: 'WORK_CENTER',
      fromWorkCenter: ultimo.workCenterRef,
      fromRoutingStepId: ultimo.id,
    };
  }

  /**
   * #1058 passo 2 — todos os centros da empresa com seu mercado de suprimento.
   *
   * Carrega a empresa INTEIRA (≈ dezenas de linhas), não só os envolvidos:
   * a resolução de mercado precisa enxergar mercados que nenhum roteiro
   * referencia diretamente (Almoxarifado, marcenaria) para as exceções da
   * Montagem.
   */
  private async carregarCentrosComMercado(companyId: string): Promise<{
    porId: Map<string, { supplyMarket: DispatchWorkCenterRef | null; supplyMarketCode: string | null }>;
    porCodigo: Map<string, DispatchWorkCenterRef>;
  }> {
    const centros = await this.prisma.workCenter.findMany({
      where: { companyId },
      select: {
        id: true,
        code: true,
        name: true,
        supplyMarket: { select: { id: true, code: true, name: true } },
      },
    });

    const porId = new Map<
      string,
      { supplyMarket: DispatchWorkCenterRef | null; supplyMarketCode: string | null }
    >();
    const porCodigo = new Map<string, DispatchWorkCenterRef>();
    for (const c of centros) {
      porCodigo.set(c.code, { workCenterId: c.id, code: c.code, name: c.name });
      porId.set(c.id, {
        supplyMarket: c.supplyMarket
          ? { workCenterId: c.supplyMarket.id, code: c.supplyMarket.code, name: c.supplyMarket.name }
          : null,
        supplyMarketCode: c.supplyMarket?.code ?? null,
      });
    }
    return { porId, porCodigo };
  }

  /**
   * #1058 passo 2 — por qual mercado esta linha de OC passa.
   *
   * Regra geral: o mercado padrão do centro CONSUMIDOR (`supplyMarketId`).
   * Exceção da Montagem (consumidor cujo padrão é o Mercado Montagem Metal),
   * decidida pelo Rafael em 11/08/2026:
   *   - item comprado/estoque (EXTERNAL_OR_STOCK) → Almoxarifado;
   *   - item vindo da marcenaria (o produtor compra do mercado da marcenaria,
   *     que guarda a madeira bruta E recebe as peças prontas) → mercado da
   *     marcenaria.
   * Sem mercado configurado no consumidor → `null` (a tela mostra a origem crua).
   */
  private resolverMercado(
    consumerWorkCenterId: string,
    sourceType: DispatchSourceType,
    fromWorkCenter: DispatchWorkCenterRef | null,
    centros: Awaited<ReturnType<DispatchService['carregarCentrosComMercado']>>,
  ): DispatchWorkCenterRef | null {
    const consumidor = centros.porId.get(consumerWorkCenterId);
    const padrao = consumidor?.supplyMarket ?? null;
    if (!padrao) return null;

    if (consumidor?.supplyMarketCode === MERCADO_MONTAGEM_METAL) {
      if (sourceType === 'EXTERNAL_OR_STOCK') {
        return centros.porCodigo.get(MERCADO_ALMOXARIFADO) ?? padrao;
      }
      if (fromWorkCenter) {
        const origem = centros.porId.get(fromWorkCenter.workCenterId);
        if (origem?.supplyMarketCode === MERCADO_MARCENARIA) {
          return centros.porCodigo.get(MERCADO_MARCENARIA) ?? padrao;
        }
      }
    }
    return padrao;
  }

  private refProduto(
    productId: string,
    produtos: ReadonlyMap<string, InfoProduto>,
  ): DispatchProductRef {
    const info = produtos.get(productId);
    // Um componente sem produto legível nesta empresa não deve derrubar o
    // despacho inteiro: aparece identificado pelo id, e segue.
    return {
      productId,
      sku: info?.sku ?? '(sem SKU)',
      name: info?.name ?? '(produto não encontrado nesta empresa)',
      unit: info?.unit ?? 'UN',
    };
  }

  /**
   * Arredonda SOMENTE na borda da resposta, e devolve string.
   *
   * String, e não `number`, porque o cálculo é feito em `Decimal` justamente
   * para não perder casas — devolver `number` reintroduziria em JSON o erro de
   * ponto flutuante que a #980 tirou da conta. É também o formato que o resto
   * da API já usa para `Decimal` do Prisma.
   */
  private formatar(valor: Prisma.Decimal): string {
    return valor.toDecimalPlaces(CASAS_DECIMAIS).toString();
  }
}
