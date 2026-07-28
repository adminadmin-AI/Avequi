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

/**
 * Edição de um lançamento financeiro JÁ existente e EM ABERTO (OPEN/OVERDUE).
 * Só os campos "de cadastro" do título — nunca `type`, `status`, `amount pago`
 * ou recorrência (essas têm fluxos próprios: pay/cancel/installments).
 *
 * Todos os campos são opcionais: o front envia apenas o que mudou (PATCH
 * parcial). `null`/'' em supplierId/categoryId/costCenterId = desvincular.
 */
export class UpdateFinancialEntryDto {
  // Paridade com a criação: se vier, não pode ser vazia (evita apagar a
  // descrição sem querer). Ausente = mantém a atual.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  // Paridade com a criação: valor > 0 (o DB é Decimal(14,4)).
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsDateString()
  expectedPaymentDate?: string;

  @IsOptional()
  @IsString()
  supplierId?: string | null;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  // Quando presente, substitui o rateio por um único centro a 100%.
  // Ausente = mantém o rateio atual intocado (preserva multi-centro da migração).
  @IsOptional()
  @IsString()
  costCenterId?: string | null;

  // ── Fase 2 do detalhe — campos de pagamento/documento do título ────────────
  // null/'' limpa o campo; ausente mantém.

  @IsOptional()
  @IsDateString()
  issueDate?: string | null; // emissão do documento

  @IsOptional()
  @IsString()
  @MaxLength(60)
  documentNumber?: string | null; // nº do documento (NF/fatura/duplicata)

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod | null; // Boleto/PIX/Cheque/Débito Automático…

  // Linha digitável/código de barras do boleto — ÚNICO por conta. Aceita só
  // dígitos: 44 (código de barras), 47 (cobrança) ou 48 (arrecadação). O front
  // remove pontos/espaços antes de enviar; '' limpa (ValidateIf pula a regex).
  @ValidateIf((o) => o.boletoBarcode != null && o.boletoBarcode !== '')
  @Matches(/^\d{44}$|^\d{47}$|^\d{48}$/, {
    message: 'boletoBarcode deve ter 44, 47 ou 48 dígitos (somente números)',
  })
  boletoBarcode?: string | null;

  // BR Code (PIX Copia e Cola) da cobrança — ÚNICO por conta.
  @IsOptional()
  @IsString()
  @MaxLength(512)
  pixCopiaECola?: string | null;
}
