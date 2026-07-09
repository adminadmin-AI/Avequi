import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateInvestmentProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountRatePct?: number;
}
