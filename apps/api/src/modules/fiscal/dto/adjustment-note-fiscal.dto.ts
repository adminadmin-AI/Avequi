import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// #757 — Notas de Débito/Crédito IBS/CBS (finNFe 5/6, SINIEF 49/2025).
// Exatamente UM modo por requisição: full | totalDelta | itemDeltas | amount.
// O service resolve o modo e o motor #755 valida contra a NF-e original.

export class AdjustmentItemDeltaDto {
  @ApiProperty({ description: 'id do FiscalDocumentItem da NF-e original' })
  @IsString()
  fiscalDocumentItemId: string;

  @ApiProperty({ description: 'redução/acréscimo de base do item (R$)', example: 500.0 })
  @IsNumber()
  @IsPositive()
  baseDelta: number;
}

export class DebitNoteFiscalDto {
  @ApiProperty({
    description:
      'tpNFDebito — 01 transf. créditos cooperativa · 02 anulação de crédito por saídas imunes/isentas · 03 débitos de NF não processadas na apuração · 04 multa e juros · 05 transf. de crédito na sucessão · 06 pagamento antecipado · 07 perda em estoque · 08 desenquadramento SN',
    enum: ['01', '02', '03', '04', '05', '06', '07', '08'],
  })
  @IsIn(['01', '02', '03', '04', '05', '06', '07', '08'])
  tipo: string;

  @ApiPropertyOptional({ description: 'valor avulso (ex.: multa e juros) — vira item sintético', example: 350.0 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ description: 'descrição do item sintético (modo amount)', example: 'MULTA E JUROS ATRASO' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  description?: string;

  @ApiPropertyOptional({ type: [AdjustmentItemDeltaDto], description: 'delta de base por item da NF-e original' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdjustmentItemDeltaDto)
  itemDeltas?: AdjustmentItemDeltaDto[];

  @ApiPropertyOptional({ description: 'justificativa — vai nas informações complementares' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  justificativa?: string;
}

export class CreditNoteFiscalDto {
  @ApiProperty({
    description:
      'tpNFCredito — 01 multa e juros · 02 crédito presumido ZFM · 03 retorno por recusa na entrega · 04 redução de valores · 05 transf. de crédito na sucessão · 06 recusa parcial na entrega',
    enum: ['01', '02', '03', '04', '05', '06'],
  })
  @IsIn(['01', '02', '03', '04', '05', '06'])
  tipo: string;

  @ApiPropertyOptional({ description: 'true = estorno integral de todos os itens (ex.: recusa total)' })
  @IsOptional()
  full?: boolean;

  @ApiPropertyOptional({ description: 'valor avulso (ex.: multa e juros creditados) — vira item sintético' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ description: 'descrição do item sintético (modo amount)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  description?: string;

  @ApiPropertyOptional({ description: 'redução total (R$) rateada proporcionalmente entre os itens', example: 1000.0 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  totalDelta?: number;

  @ApiPropertyOptional({ type: [AdjustmentItemDeltaDto], description: 'redução de base por item da NF-e original' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdjustmentItemDeltaDto)
  itemDeltas?: AdjustmentItemDeltaDto[];

  @ApiPropertyOptional({ description: 'justificativa — vai nas informações complementares' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  justificativa?: string;
}
