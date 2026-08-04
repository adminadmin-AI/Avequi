import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** AVECCHI P2 (#963) — criação de proposta comercial de assinatura. */
export class CreateProposalDto {
  @IsString()
  planId!: string;

  /** Ausente = preço de TABELA do plano; presente = valor negociado. */
  @IsOptional()
  @IsInt()
  @Min(1)
  priceCents?: number;

  /** 1–28 (mesma regra da assinatura — fevereiro nunca quebra a régua). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  billingDay?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  conditions?: string;

  @IsOptional()
  @IsISO8601()
  validUntil?: string;
}

export class DecideProposalDto {
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  decidedNote?: string;
}
