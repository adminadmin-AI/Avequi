import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEFAULT_OPTIONS_TAKE, MAX_PAGE_SIZE } from '../../../common/pagination/paginate.util';

/**
 * Query do GET /products/options (#1028 parte 2) — combobox de formulário.
 * Sem envelope de paginação: devolve um lote único (`take`, teto 100) já
 * ordenado, payload enxuto (ver `PRODUCT_OPTIONS_SELECT` em product.service.ts
 * para o que exatamente volta e por quê). Não serve para a tela de lista
 * (usa GET /products).
 */
export class ProductOptionsQueryDto {
  @ApiPropertyOptional({ description: 'Busca em SKU ou nome' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: DEFAULT_OPTIONS_TAKE, minimum: 1, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  take?: number;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Sem filtro por padrão (mesmo comportamento de GET /products); passe "true" para excluir produtos inativos (ex.: item de venda/orçamento novo).',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;
}
