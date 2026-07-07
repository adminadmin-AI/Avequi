import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class CreateDebtDto {
  @ApiProperty({ enum: ['FINAME', 'LEASING', 'CAPITAL_GIRO', 'CHEQUE_ESPECIAL', 'OUTROS'] })
  @IsIn(['FINAME', 'LEASING', 'CAPITAL_GIRO', 'CHEQUE_ESPECIAL', 'OUTROS'])
  type: string;

  @ApiProperty({ example: 'BNDES via Banco X' }) @IsString() @IsNotEmpty() bank: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiProperty({ example: 250000 }) @IsNumber() @IsPositive() principal: number;
  @ApiProperty({ example: 1.2, description: 'Juros % a.m.' }) @IsNumber() @Min(0) interestRate: number;

  @ApiPropertyOptional({ enum: ['PRICE', 'SAC'], default: 'PRICE' })
  @IsOptional()
  @IsIn(['PRICE', 'SAC'])
  amortizationType?: 'PRICE' | 'SAC';

  @ApiProperty({ example: 48 }) @IsInt() @Min(1) installmentsCount: number;
  @ApiProperty({ example: '2026-07-01' }) @IsDateString() contractedAt: string;
  @ApiProperty({ example: '2026-08-05' }) @IsDateString() firstDueDate: string;
}
