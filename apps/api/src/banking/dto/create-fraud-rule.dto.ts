import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';

const TRANSACTION_TYPES = ['BOLETO', 'PIX', 'TRANSFER', 'PAYMENT'] as const;

export class CreateFraudRuleDto {
  @ApiPropertyOptional({ description: 'ID da conta bancária (null = regra para toda a empresa)' })
  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @ApiProperty({ description: 'Tipo de transação', enum: TRANSACTION_TYPES })
  @IsString()
  @IsIn(TRANSACTION_TYPES)
  transactionType!: string;

  @ApiProperty({ description: 'Valor máximo permitido para este tipo de transação', example: 50000 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  maxAmount!: number;
}
