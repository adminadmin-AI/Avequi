import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsDecimal,
  IsNotEmpty,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateBoletoDto {
  @ApiProperty({ description: 'ID da conta bancária' })
  @IsString()
  @IsNotEmpty()
  bankAccountId: string;

  @ApiPropertyOptional({ description: 'ID do recebível vinculado' })
  @IsOptional()
  @IsString()
  receivableId?: string;

  @ApiProperty({ description: 'Nosso número (identificador único do banco)' })
  @IsString()
  @IsNotEmpty()
  nossoNumero: string;

  @ApiPropertyOptional({ description: 'Seu número (referência do emitente)' })
  @IsOptional()
  @IsString()
  seuNumero?: string;

  @ApiProperty({ description: 'Valor do boleto', example: 1500.00 })
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @ApiProperty({ description: 'Data de vencimento (ISO 8601)', example: '2026-07-31' })
  @IsDateString()
  dueDate: string;

  @ApiProperty({ description: 'Nome do pagador' })
  @IsString()
  @IsNotEmpty()
  payerName: string;

  @ApiProperty({ description: 'CPF ou CNPJ do pagador' })
  @IsString()
  @IsNotEmpty()
  payerDocument: string;

  @ApiPropertyOptional({ description: 'Endereço do pagador' })
  @IsOptional()
  @IsString()
  payerAddress?: string;

  @ApiPropertyOptional({ description: 'Cidade do pagador' })
  @IsOptional()
  @IsString()
  payerCity?: string;

  @ApiPropertyOptional({ description: 'Estado do pagador (UF)' })
  @IsOptional()
  @IsString()
  payerState?: string;

  @ApiPropertyOptional({ description: 'CEP do pagador' })
  @IsOptional()
  @IsString()
  payerZipCode?: string;

  @ApiPropertyOptional({ description: 'Instruções para o caixa' })
  @IsOptional()
  @IsString()
  instructions?: string;
}
