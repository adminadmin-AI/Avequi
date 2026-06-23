import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, Min } from 'class-validator';

export class CreateCreditLimitDto {
  @ApiProperty({ description: 'ID do cliente' })
  @IsString()
  customerId: string;

  @ApiProperty({ description: 'Limite máximo de crédito em reais', example: 10000.0 })
  @IsNumber()
  @Min(0)
  maxAmount: number;

  @ApiPropertyOptional({ description: 'Observações sobre o limite' })
  @IsOptional()
  @IsString()
  notes?: string;
}
