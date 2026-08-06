import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEFAULT_OPTIONS_TAKE, MAX_PAGE_SIZE } from '../../../common/pagination/paginate.util';

/**
 * Query do GET /customers/options (#1028 parte 2) — combobox de formulário.
 * Sem envelope de paginação: devolve um lote único (`take`, teto 100) já
 * ordenado, payload mínimo. Não serve para a tela de lista (usa GET /customers).
 */
export class CustomerOptionsQueryDto {
  @ApiPropertyOptional({ description: 'Busca em nome ou documento' })
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
    description: 'Sem filtro por padrão (mesmo comportamento de GET /customers); passe "true" para excluir clientes inativos.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;
}
