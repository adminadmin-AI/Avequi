import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * DTOs da gestão de planos e entitlements — OPS WP4 (#911).
 * O conteúdo de `entitlements`/`value` é validado contra o catálogo em código
 * no PlansService (validateEntitlements) — aqui só a forma.
 */

export class CreatePlanDto {
  @ApiProperty({ example: 'PROFISSIONAL', description: 'Código único (A-Z_)' })
  @Matches(/^[A-Z][A-Z0-9_]{1,30}$/, {
    message: 'code deve ser MAIÚSCULO (A-Z, 0-9, _), 2–31 caracteres',
  })
  code: string;

  @ApiProperty({ example: 'Profissional' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({
    description: 'Mapa { key: valor } validado contra o catálogo de entitlements',
    example: { crm: true, renave: false, maxUsers: 25 },
  })
  @IsObject()
  entitlements: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Preço de tabela em centavos (referência)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ description: 'Substitui o mapa inteiro de entitlements' })
  @IsOptional()
  @IsObject()
  entitlements?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AssignPlanDto {
  @ApiPropertyOptional({
    description: 'Id do plano; null remove (tenant volta ao modo legado — tudo liberado)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  planId?: string | null;
}

export class SetOverrideDto {
  @ApiProperty({ description: 'Valor da exceção (bool ou número, conforme a key)' })
  value: unknown;

  @ApiProperty({ description: 'Motivo da exceção — auditável', minLength: 5 })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason: string;
}
