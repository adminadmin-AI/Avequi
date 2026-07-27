import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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
}
