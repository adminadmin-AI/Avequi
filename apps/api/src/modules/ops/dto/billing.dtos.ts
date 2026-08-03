import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { INVOICE_METHODS } from '../billing.service';

/** DTOs do billing da operadora — OPS WP5 (#912). */

export class UpsertSubscriptionDto {
  @ApiPropertyOptional({ description: 'Plano de referência comercial (id); null = sem vínculo' })
  @IsOptional()
  @IsString()
  planId?: string | null;

  @ApiProperty({ description: 'Valor NEGOCIADO em centavos (pode diferir da tabela)' })
  @IsInt()
  @Min(0)
  priceCents: number;

  @ApiProperty({ description: 'Dia do vencimento (1–28)' })
  @IsInt()
  @Min(1)
  @Max(28)
  billingDay: number;

  @ApiPropertyOptional({ description: 'Início da vigência (ISO). Default: agora / vigente' })
  @IsOptional()
  @IsISO8601()
  startedAt?: string;
}

export class PayInvoiceDto {
  @ApiProperty({ enum: INVOICE_METHODS })
  @IsIn(INVOICE_METHODS as unknown as string[])
  method: string;
}

export class VoidInvoiceDto {
  @ApiProperty({ description: 'Motivo da anulação — auditável', minLength: 5 })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason: string;
}
