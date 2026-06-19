import { IsString, IsOptional, IsNumber, IsBoolean, Min, Max } from 'class-validator';

export class CreateWorkCenterDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(24)
  capacityHoursPerDay?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  operatorsCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  efficiencyPct?: number;
}
