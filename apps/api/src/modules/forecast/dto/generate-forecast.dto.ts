import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class GenerateForecastDto {
  @IsString()
  companyId: string;

  // Período alvo: YYYY-MM (default: próximo mês)
  @IsOptional()
  @IsString()
  targetPeriod?: string;

  // Janela WMA em meses (3–12, default 3)
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(12)
  @Type(() => Number)
  windowMonths?: number;

  // Filtrar para um único produto (opcional)
  @IsOptional()
  @IsString()
  productId?: string;
}
