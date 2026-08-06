import { ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerType } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

/** Query do GET /customers (#1028) — busca/filtro resolvidos no banco, paginados. */
export class CustomerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Busca em nome ou documento' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: CustomerType })
  @IsOptional()
  @IsEnum(CustomerType)
  type?: CustomerType;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;

  @ApiPropertyOptional({ description: 'Filtra por tag de segmentação (#476)' })
  @IsOptional()
  @IsString()
  tagId?: string;
}
