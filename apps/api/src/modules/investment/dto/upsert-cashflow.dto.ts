import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpsertCashflowDto {
  // Período: 0 = aporte inicial, 1..N = períodos seguintes
  @IsInt()
  @Min(0)
  period: number;

  // Sinal: negativo = saída (investimento), positivo = entrada
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  label?: string;
}
