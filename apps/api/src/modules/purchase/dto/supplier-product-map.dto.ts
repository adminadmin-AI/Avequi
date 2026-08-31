import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Fase 2 PR-2 — DTOs do de-para fornecedor+cProd → Product. */

export class ListSupplierProductMapsQueryDto {
  @ApiPropertyOptional({ enum: ['UNRESOLVED', 'SUGGESTED', 'CONFIRMED', 'REVIEW'] })
  @IsOptional() @IsIn(['UNRESOLVED', 'SUGGESTED', 'CONFIRMED', 'REVIEW'])
  status?: 'UNRESOLVED' | 'SUGGESTED' | 'CONFIRMED' | 'REVIEW';

  @ApiPropertyOptional({ description: 'Filtrar por fornecedor (id)' })
  @IsOptional() @IsString()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Busca em cProd, descrição, fornecedor' })
  @IsOptional() @IsString() @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ description: 'Só pares ligados a BOM ativa (canônico ou sugestão)' })
  @IsOptional() @Type(() => Boolean) @IsBoolean()
  bomOnly?: boolean;

  @ApiPropertyOptional({ description: 'Só pares que ainda precisam de decisão (UNRESOLVED/SUGGESTED/REVIEW)' })
  @IsOptional() @Type(() => Boolean) @IsBoolean()
  pendingOnly?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number;
}

export class ConfirmProductDto {
  @ApiProperty({ description: 'Product canônico desta empresa que corresponde ao (fornecedor, cProd)' })
  @IsString() @MinLength(1)
  productId!: string;

  @ApiPropertyOptional({ description: 'Razão (registrada no evento de auditoria)' })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class ClassifyDto {
  @ApiProperty({ enum: ['CONSUMABLE', 'ASSET', 'FREIGHT_OTHER'], description: 'Classificação NÃO-produto (para PRODUCT use confirm-product)' })
  @IsIn(['CONSUMABLE', 'ASSET', 'FREIGHT_OTHER'])
  kind!: 'CONSUMABLE' | 'ASSET' | 'FREIGHT_OTHER';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class SuggestDto {
  @ApiPropertyOptional({ description: 'Product sugerido (implica kind PRODUCT)' })
  @IsOptional() @IsString()
  productId?: string;

  @ApiPropertyOptional({ enum: ['PRODUCT', 'CONSUMABLE', 'ASSET', 'FREIGHT_OTHER'] })
  @IsOptional() @IsIn(['PRODUCT', 'CONSUMABLE', 'ASSET', 'FREIGHT_OTHER'])
  kind?: 'PRODUCT' | 'CONSUMABLE' | 'ASSET' | 'FREIGHT_OTHER';

  @ApiPropertyOptional({ description: 'Razão/justificativa da sugestão (vai para o evento)' })
  @IsOptional() @IsString() @MaxLength(500)
  rationale?: string;
}

export class ReasonDto {
  @ApiProperty({ description: 'Razão (obrigatória para review)' })
  @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}

export class OptionalReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class ApplyDto {
  @ApiPropertyOptional({ description: 'false (default) = só prévia; true = grava como SUGGESTED (nunca CONFIRMED)', default: false })
  @IsOptional() @IsBoolean()
  apply?: boolean;
}
