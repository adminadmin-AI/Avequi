import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsIn, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

const TRANSACTION_TYPES = ['BOLETO', 'PIX', 'TRANSFER', 'PAYMENT'] as const;

export class CheckFraudDto {
  @ApiProperty({ description: 'ID da conta bancária' })
  @IsString()
  bankAccountId!: string;

  @ApiProperty({ description: 'Valor da transação', example: 5000 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount!: number;

  @ApiProperty({ description: 'Tipo de transação', enum: TRANSACTION_TYPES })
  @IsString()
  @IsIn(TRANSACTION_TYPES)
  type!: string;

  @ApiPropertyOptional({ description: 'Metadados adicionais', type: 'object' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
