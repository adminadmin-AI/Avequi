import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateBudgetPlanDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

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
