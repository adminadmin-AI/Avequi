import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateCostCenterDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  // #396 Custeio por absorção — despesas indiretas (CIF) mensais do centro
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyCif?: number;

  // Horas produtivas do período (denominador do rateio CIF/hora)
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyProductiveHours?: number;
}
