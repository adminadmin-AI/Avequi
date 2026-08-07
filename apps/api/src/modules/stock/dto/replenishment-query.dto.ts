import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

/**
 * Status de reposição — calculado no SERVIDOR a partir do saldo somado por
 * depósito vs. `Product.minStock` (#1031). Regras (ver `classifyReplenishment`
 * em `stock.service.ts` para os limites exatos, inclusive casos de borda):
 *  - BELOW_MIN: saldo abaixo do mínimo — repor agora.
 *  - AT_RISK: saldo no mínimo ou até 20% acima dele — folga curta, vale
 *    acompanhar antes de virar BELOW_MIN.
 *  - OK: saldo confortavelmente acima do mínimo, OU produto sem mínimo
 *    definido (minStock <= 0 — não há política de reposição para ele).
 */
export enum ReplenishmentStatus {
  BELOW_MIN = 'BELOW_MIN',
  AT_RISK = 'AT_RISK',
  OK = 'OK',
}

/**
 * Query do GET /stock/replenishment (#1031). Paginado pelo contrato canônico
 * da #1028 (herdado de `PaginationQueryDto`): envelope `{items,total,page,
 * pageSize}`, teto de 100/página.
 */
export class ReplenishmentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ReplenishmentStatus,
    description:
      'Filtra por status de reposição. Sem filtro, retorna o que precisa de atenção (BELOW_MIN + AT_RISK) — itens OK ficam de fora por padrão.',
  })
  @IsOptional()
  @IsEnum(ReplenishmentStatus)
  status?: ReplenishmentStatus;

  @ApiPropertyOptional({
    description:
      'Restringe o saldo somado a um único depósito (em vez do total da empresa em todos os depósitos).',
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({
    enum: ProductType,
    description:
      'Categoria do produto. O schema não tem um campo `category` dedicado — reusa `Product.type` (mesmo filtro de GET /products).',
  })
  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;
}
