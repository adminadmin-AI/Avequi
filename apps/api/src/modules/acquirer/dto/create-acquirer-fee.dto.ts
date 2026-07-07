import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentModality } from '@prisma/client';

/** Regra de taxa MDR + prazo de liquidação (#585) */
export class CreateAcquirerFeeDto {
  @ApiPropertyOptional({ description: 'Bandeira (VISA, MASTERCARD...); vazio = qualquer' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  brand?: string;

  @ApiProperty({ enum: PaymentModality })
  @IsEnum(PaymentModality)
  modality: PaymentModality;

  @ApiPropertyOptional({ description: 'Parcelas — início da faixa', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  installmentsFrom?: number;

  @ApiPropertyOptional({ description: 'Parcelas — fim da faixa', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  installmentsTo?: number;

  @ApiProperty({ description: 'Taxa MDR (%) descontada pela adquirente', example: 3.49 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  mdrRate: number;

  @ApiProperty({ description: 'Prazo de liquidação D+n da 1ª parcela (débito D+1, crédito D+30)', example: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  settlementDays: number;

  @ApiPropertyOptional({ description: 'Início de vigência (ISO); vazio = sem limite' })
  @IsOptional()
  @IsISO8601()
  validFrom?: string;

  @ApiPropertyOptional({ description: 'Fim de vigência (ISO); vazio = vigente' })
  @IsOptional()
  @IsISO8601()
  validTo?: string;
}
