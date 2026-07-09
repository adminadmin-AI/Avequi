import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateInvestmentProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Taxa de desconto por período (WACC), % — coerente com a granularidade dos fluxos
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountRatePct?: number;
}
