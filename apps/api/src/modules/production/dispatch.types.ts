/**
 * #817 — Contrato de saída do despacho por setor.
 *
 * O que este endpoint responde, em uma frase: *dado um carrinho de modelos,
 * o que cada centro de trabalho da fábrica produz (OS) e o que ele precisa
 * receber para produzir (OC)?*
 *
 * Vocabulário, porque as siglas são do chão de fábrica e não do software:
 *   - **OS (Ordem de Serviço)** — o item que aquele centro de trabalho PROCESSA
 *     naquela operação. Uma operação tem exatamente uma OS.
 *   - **OC (Ordem de Coleta)** — o que aquele centro de trabalho RECEBE para
 *     conseguir executar a operação. É a união de dois conjuntos: o próprio
 *     item vindo da operação anterior do seu roteiro, e os componentes da BOM
 *     alocados àquela operação (`BomItem.routingStepId`, criado na #815).
 *
 * ─── Por que o agrupamento é por `WorkCenter`, e não por área ───────────────
 *
 * A #874 vai modelar `WorkCenterGroup` (grupos/áreas de centros de trabalho).
 * Seria natural esperar por ela para entregar "área → setor → operação". A
 * decisão registrada na #817 foi NÃO esperar: o agrupamento que o despacho
 * precisa é por `WorkCenter`, que já existe, já é a FK oficial do `RoutingStep`
 * desde a #815 e já tem os 34 registros da GDR em produção. Grupo é camada
 * ACIMA disso — de organização e de tela —, não dependência do cálculo.
 *
 * Consequência para este contrato: a resposta é um **objeto envelope** e os
 * centros de trabalho vêm numa lista própria (`workCenters`). Quando a #874
 * existir, ela acrescenta uma chave IRMÃ (por exemplo `groups`, referenciando
 * os `workCenterId` que já estão aqui) sem tocar em nada do que existe. A
 * adição é aditiva por construção e nenhum consumidor quebra.
 *
 * E o que deliberadamente NÃO se faz: derivar área a partir de `description`,
 * de prefixo de código de peça ou de qualquer lista fixa de nomes. Regra assim
 * funciona na GDR e quebra no primeiro cliente seguinte — hierarquia tem de vir
 * de dado modelado, que é justamente o que a #874 vai criar.
 */

import { Inconsistency } from '../../common/production/bom-explosion';

/**
 * De onde vem um item que aparece numa OC.
 *
 * Não existe "todo componente veio de outro setor": a maior parte das peças de
 * uma carretinha é comprada, e supor origem produtiva para todas produziria um
 * fluxo de fábrica fictício.
 */
export type DispatchSourceType =
  /** Veio de outro centro de trabalho (item fabricado, com roteiro e setor). */
  | 'WORK_CENTER'
  /** Comprado ou sem roteiro produtivo: vem do estoque / de fora. */
  | 'EXTERNAL_OR_STOCK'
  /** Não foi possível determinar — e isso fica visível, não vira suposição. */
  | 'UNDEFINED';

/** Por que este item está na OC desta operação. */
export type DispatchOriginKind =
  /**
   * O próprio item processado, chegando da operação ANTERIOR do seu roteiro.
   *
   * Este caso é indispensável e não é um `BomItem`: um conjunto não é
   * componente de si mesmo. Sem ele, a OC da Galvanização (passo 2 de
   * `CON-CHA-003`, que recebe o conjunto da Solda) sairia vazia.
   * Derivado por `stepOrder`, sem campo novo no schema.
   */
  | 'PREVIOUS_OPERATION'
  /** Componente da BOM alocado a esta operação via `BomItem.routingStepId`. */
  | 'BOM_COMPONENT';

/** Motivo estruturado pelo qual algo não pôde ser despachado. */
export type DispatchPendencyCode =
  /** Item fabricado (tem BOM ativa) e sem nenhum `RoutingStep`. */
  | 'MISSING_ROUTING'
  /** O passo do roteiro existe, mas não aponta para nenhum centro de trabalho. */
  | 'MISSING_WORK_CENTER'
  /** `BomItem` sem `routingStepId`: o componente não foi alocado a operação alguma. */
  | 'UNALLOCATED_COMPONENT'
  /** Produto de tipo fabricável (acabado/semiacabado) sem BOM ativa. */
  | 'MISSING_ACTIVE_BOM'
  /**
   * O `routingStepId` do `BomItem` aponta para um passo que não é do produto
   * dono da BOM (ou não existe nesta empresa). Alocação impossível de honrar.
   */
  | 'ROUTING_STEP_MISMATCH';

/** Identificação de produto repetida em toda a resposta. */
export interface DispatchProductRef {
  productId: string;
  sku: string;
  name: string;
  unit: string;
}

/** Centro de trabalho, no mínimo necessário para a tela e para a #874. */
export interface DispatchWorkCenterRef {
  workCenterId: string;
  code: string;
  name: string;
}

/** Eco do carrinho recebido, já resolvido para SKU e nome. */
export interface DispatchCartEcho extends DispatchProductRef {
  /** Quantidade pedida, como string decimal exata. */
  quantity: string;
}

/** Uma linha da OC: algo que o centro de trabalho recebe. */
export interface DispatchCollectItem extends DispatchProductRef {
  /** Quantidade total a receber nesta operação, como string decimal exata. */
  quantity: string;
  sourceType: DispatchSourceType;
  originKind: DispatchOriginKind;
  /** Centro de trabalho de onde vem, quando `sourceType = WORK_CENTER`. */
  fromWorkCenter: DispatchWorkCenterRef | null;
  /** Operação de origem, quando conhecida. */
  fromRoutingStepId: string | null;
  /**
   * `BomItem`s que geraram esta linha. Vazio quando `originKind` é
   * `PREVIOUS_OPERATION` (essa passagem não nasce de linha de BOM).
   * Mais de um quando o mesmo componente entra por linhas diferentes.
   */
  bomItemIds: string[];
}

/** Uma operação executada num centro de trabalho. */
export interface DispatchOperation {
  routingStepId: string;
  stepOrder: number;
  stepName: string;
  /** É o primeiro passo do roteiro deste produto? */
  isFirstStep: boolean;
  /** O item PROCESSADO aqui — a OS. */
  os: DispatchProductRef & { quantity: string };
  /** O que precisa chegar para a operação acontecer — a OC. */
  oc: DispatchCollectItem[];
}

/** Um centro de trabalho e tudo que ele faz para este carrinho. */
export interface DispatchWorkCenter extends DispatchWorkCenterRef {
  operations: DispatchOperation[];
}

/** Algo que não pôde ser despachado — com motivo, nunca em silêncio. */
export interface DispatchPendency extends DispatchProductRef {
  code: DispatchPendencyCode;
  /** Quantidade envolvida, como string decimal exata. */
  quantity: string;
  /** Frase pronta em português, para aparecer na tela sem tradução. */
  detail: string;
  /** Operação envolvida, quando o motivo é de roteiro. */
  routingStepId?: string;
}

/**
 * Resposta completa do despacho.
 *
 * `inconsistencies` vem do `BomExplosionService` (BOM ativa ambígua, ciclo,
 * profundidade estourada) e é DIFERENTE de `pendencies`: uma é problema da
 * estrutura de produto, a outra é falta de cadastro de roteiro. Misturar as
 * duas esconderia qual cadastro precisa de atenção.
 */
export interface DispatchResult {
  cart: DispatchCartEcho[];
  workCenters: DispatchWorkCenter[];
  pendencies: DispatchPendency[];
  inconsistencies: Inconsistency[];
}
