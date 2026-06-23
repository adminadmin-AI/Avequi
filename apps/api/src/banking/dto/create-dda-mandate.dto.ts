import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsDateString,
  IsNumber,
  IsPositive,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDdaMandateDto {
  @ApiProperty({ description: 'ID do cliente (sacado)' })
  @IsString()
  customerId!: string;

  @ApiProperty({ description: 'ID da conta bancária para débito' })
  @IsString()
  bankAccountId!: string;

  @ApiPropertyOptional({ description: 'Valor máximo por débito (em reais)' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  maxAmount?: number;

  @ApiProperty({ description: 'Data início do mandato (ISO 8601)' })
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional({ description: 'Data fim do mandato (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Referência/identificador externo do mandato' })
  @IsOptional()
  @IsString()
  reference?: string;
}
