import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

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

  // ── Fase 2 do detalhe — campos de pagamento/documento (todos opcionais) ────

  @IsOptional()
  @IsDateString()
  issueDate?: string; // emissão do documento

  @IsOptional()
  @IsString()
  @MaxLength(60)
  documentNumber?: string; // nº do documento (NF/fatura/duplicata)

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  // Linha digitável/código de barras do boleto (44/47/48 dígitos) — ver
  // UpdateFinancialEntryDto para a semântica completa.
  @ValidateIf((o) => o.boletoBarcode != null && o.boletoBarcode !== '')
  @Matches(/^\d{44}$|^\d{47}$|^\d{48}$/, {
    message: 'boletoBarcode deve ter 44, 47 ou 48 dígitos (somente números)',
  })
  boletoBarcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  pixCopiaECola?: string; // BR Code (PIX Copia e Cola) da cobrança
}
