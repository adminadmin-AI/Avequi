/**
 * #817 — Espelho em classes do contrato de resposta, só para o Swagger.
 *
 * Por que existe: o `dispatch.types.ts` é feito de `interface`, que **some na
 * compilação**. Sem estas classes o `/docs` não mostraria nada da resposta, e
 * quem for consumir o endpoint (a tela da #874, um integrador, o próprio
 * Rafael conferindo) veria só o corpo de entrada.
 *
 * O risco concreto de não documentar não é estético: **as quantidades são
 * `string`, não `number`**. Um consumidor que assumisse número faria
 * `qty * preco` e receberia `NaN`, ou pior, converteria para float e traria de
 * volta o erro de ponto flutuante que a #980 tirou da conta. O tipo precisa
 * estar escrito.
 *
 * Cada classe declara `implements` do tipo correspondente. Isso não é enfeite:
 * se alguém mudar o contrato em `dispatch.types.ts` e esquecer daqui, **o
 * TypeScript quebra o build** em vez de deixar a documentação envelhecer em
 * silêncio — que é o destino normal de schema escrito à mão.
 *
 * Nenhuma destas classes é usada em runtime pelo serviço: o `DispatchService`
 * continua devolvendo objetos simples.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Inconsistency, InconsistencyCode } from '../../../common/production/bom-explosion';
import {
  DispatchCartEcho,
  DispatchCollectItem,
  DispatchOperation,
  DispatchOsItem,
  DispatchOriginKind,
  DispatchPendency,
  DispatchPendencyCode,
  DispatchProductRef,
  DispatchResult,
  DispatchSourceType,
  DispatchWorkCenter,
  DispatchWorkCenterRef,
} from '../dispatch.types';

/** Texto reaproveitado: a explicação do porquê de quantidade ser string. */
const QUANTIDADE = {
  type: 'string' as const,
  description:
    'Quantidade em decimal EXATO, com até 4 casas. É string de propósito: o cálculo é feito ' +
    'em Decimal e devolver number reintroduziria erro de ponto flutuante no JSON. ' +
    'Converta com uma biblioteca decimal, nunca com parseFloat para depois somar.',
};

export class DispatchWorkCenterRefDto implements DispatchWorkCenterRef {
  @ApiProperty({ example: 'ckv1a2b3c4d5e6f7g8h9' }) workCenterId: string;
  @ApiProperty({ example: 'SET-SOL-002' }) code: string;
  @ApiProperty({ example: 'Solda 2' }) name: string;
}

export class DispatchProductRefDto implements DispatchProductRef {
  @ApiProperty({ example: 'ckv1a2b3c4d5e6f7g8h9' }) productId: string;
  @ApiProperty({ example: 'CON-CHA-003' }) sku: string;
  @ApiProperty({ example: 'Conjunto chassi 3' }) name: string;
  @ApiProperty({ example: 'UN' }) unit: string;
}

export class DispatchCartEchoDto extends DispatchProductRefDto implements DispatchCartEcho {
  @ApiProperty({ ...QUANTIDADE, example: '50' }) quantity: string;
}

export class DispatchOsDto extends DispatchProductRefDto implements DispatchOsItem {
  @ApiProperty({ ...QUANTIDADE, example: '50' }) quantity: string;
}

export class DispatchCollectItemDto extends DispatchProductRefDto implements DispatchCollectItem {
  @ApiProperty({ ...QUANTIDADE, example: '220' }) quantity: string;

  @ApiProperty({
    enum: ['WORK_CENTER', 'EXTERNAL_OR_STOCK', 'UNDEFINED'],
    description:
      'De onde o item vem. WORK_CENTER = chega pronto de outro centro de trabalho; ' +
      'EXTERNAL_OR_STOCK = comprado ou sem roteiro produtivo; ' +
      'UNDEFINED = não foi possível determinar (nunca é chute).',
  })
  sourceType: DispatchSourceType;

  @ApiProperty({
    enum: ['PREVIOUS_OPERATION', 'BOM_COMPONENT'],
    description:
      'Por que está nesta OC. PREVIOUS_OPERATION = é o PRÓPRIO item processado, chegando da ' +
      'operação anterior do roteiro dele (não é linha de BOM — um conjunto não é componente de ' +
      'si mesmo); BOM_COMPONENT = componente alocado a esta operação via BomItem.routingStepId.',
  })
  originKind: DispatchOriginKind;

  @ApiProperty({
    type: DispatchWorkCenterRefDto,
    nullable: true,
    description: 'Centro de trabalho de origem. Só vem preenchido quando sourceType = WORK_CENTER.',
  })
  fromWorkCenter: DispatchWorkCenterRefDto | null;

  @ApiProperty({ type: String, nullable: true, description: 'Operação de origem, quando conhecida.' })
  fromRoutingStepId: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Linhas de BOM que geraram esta necessidade. VAZIO quando originKind = PREVIOUS_OPERATION. ' +
      'Mais de um id quando o mesmo componente entra por linhas diferentes na mesma operação.',
  })
  bomItemIds: string[];
}

export class DispatchOperationDto implements DispatchOperation {
  @ApiProperty() routingStepId: string;
  @ApiProperty({ example: 2, description: 'Posição da operação no roteiro do produto.' }) stepOrder: number;
  @ApiProperty({ example: 'Galvanização' }) stepName: string;
  @ApiProperty({ description: 'Primeira operação do roteiro? Se não for, a OC traz o item da anterior.' })
  isFirstStep: boolean;

  @ApiProperty({ type: DispatchOsDto, description: 'OS — o item PROCESSADO nesta operação.' })
  os: DispatchOsDto;

  @ApiProperty({
    type: [DispatchCollectItemDto],
    description: 'OC — tudo que precisa CHEGAR para a operação acontecer.',
  })
  oc: DispatchCollectItemDto[];
}

export class DispatchWorkCenterDto extends DispatchWorkCenterRefDto implements DispatchWorkCenter {
  @ApiProperty({ type: [DispatchOperationDto] }) operations: DispatchOperationDto[];
}

export class DispatchPendencyDto extends DispatchProductRefDto implements DispatchPendency {
  @ApiProperty({
    enum: [
      'MISSING_ROUTING',
      'MISSING_WORK_CENTER',
      'UNALLOCATED_COMPONENT',
      'MISSING_ACTIVE_BOM',
      'ROUTING_STEP_MISMATCH',
    ],
    description: 'Por que este item NÃO pôde ser despachado.',
  })
  code: DispatchPendencyCode;

  @ApiProperty({ ...QUANTIDADE, example: '40' }) quantity: string;

  @ApiProperty({ description: 'Frase pronta em português, para exibir na tela sem tradução.' })
  detail: string;

  @ApiPropertyOptional({ description: 'Operação envolvida, quando o motivo é de roteiro.' })
  routingStepId?: string;
}

export class DispatchInconsistencyDto implements Inconsistency {
  @ApiProperty({
    enum: ['AMBIGUOUS_ACTIVE_BOM', 'BOM_CYCLE', 'MAX_DEPTH_EXCEEDED', 'INVALID_CART_QUANTITY'],
    description: 'Problema na ESTRUTURA DE PRODUTO — diferente de pendência, que é falta de roteiro.',
  })
  code: InconsistencyCode;

  @ApiProperty() productId: string;
  @ApiProperty({ description: 'Frase pronta em português.' }) detail: string;

  @ApiPropertyOptional({ type: [String], description: 'Caminho da raiz até onde o problema apareceu.' })
  path?: string[];
}

export class DispatchResponseDto implements DispatchResult {
  @ApiProperty({ type: [DispatchCartEchoDto], description: 'Eco do carrinho, já resolvido para SKU e nome.' })
  cart: DispatchCartEchoDto[];

  @ApiProperty({
    type: [DispatchWorkCenterDto],
    description:
      'O despacho, agrupado por centro de trabalho e ordenado por código. Lista própria de ' +
      'propósito: quando a #874 (WorkCenterGroup) existir, ela acrescenta uma chave IRMÃ ' +
      'referenciando estes workCenterId, sem quebrar nenhum consumidor.',
  })
  workCenters: DispatchWorkCenterDto[];

  @ApiProperty({
    type: [DispatchPendencyDto],
    description:
      'O que NÃO pôde ser despachado, com motivo. Enquanto o roteiro das peças não estiver ' +
      'cadastrado, é esperado que a maior parte do resultado caia aqui.',
  })
  pendencies: DispatchPendencyDto[];

  @ApiProperty({
    type: [DispatchInconsistencyDto],
    description: 'Problemas da estrutura de produto encontrados durante a explosão da BOM.',
  })
  inconsistencies: DispatchInconsistencyDto[];
}
