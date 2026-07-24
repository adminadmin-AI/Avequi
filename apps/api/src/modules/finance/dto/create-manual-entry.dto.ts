import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateManualEntryDto {
  @IsEnum(['PAYABLE', 'RECEIVABLE'])
  type: 'PAYABLE' | 'RECEIVABLE';

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsDateString()
  @IsNotEmpty()
  dueDate: string;

  // #788 — previsão de pagamento (opcional). Se ausente, o service usa o vencimento.
  @IsOptional()
  @IsDateString()
  expectedPaymentDate?: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  // #785 — fornecedor do título (contas a pagar). Opcional.
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  costCenterId?: string;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsEnum(['NONE', 'WEEKLY', 'MONTHLY'])
  recurrence?: 'NONE' | 'WEEKLY' | 'MONTHLY';

  @IsOptional()
  @IsNumber()
  @Min(1)
  recurrenceCount?: number;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;
}
