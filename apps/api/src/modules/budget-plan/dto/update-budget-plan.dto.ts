import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateBudgetPlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  variableExpensePct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fixedExpenseMonthly?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capex?: number;
}
