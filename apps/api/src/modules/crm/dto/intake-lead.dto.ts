import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadSource } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Entrada única de lead (#513). Usado pela tela de registro manual (F1.6) e,
 * internamente, por todos os conectores (F1.2/F1.4/F1.5). companyId NUNCA vem
 * do cliente HTTP — no controller ele é o do JWT; conectores passam a loja
 * resolvida por eles direto ao service.
 */
export class IntakeLeadDto {
  @ApiPropertyOptional({ description: 'Nome do contato' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description: 'Telefone em qualquer formato BR — normalizado p/ E.164',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @ApiProperty({ enum: LeadSource })
  @IsEnum(LeadSource)
  source: LeadSource;

  @ApiPropertyOptional({
    description: 'Ref externa da origem (conta ML, leadgen_id Meta...) — dedup secundário',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalRef?: string;

  @ApiPropertyOptional({ description: 'Metadados da captação (campanha, anúncio...)' })
  @IsOptional()
  @IsObject()
  sourceMeta?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Modelo/categoria de interesse' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  interest?: string;

  @ApiPropertyOptional({ description: 'Valor estimado (R$)' })
  @IsOptional()
  @IsNumber()
  estimatedValue?: number;
}
