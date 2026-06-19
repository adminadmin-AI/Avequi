import { IsDateString, IsOptional } from 'class-validator';

export class QueryProductionCostsDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  groupBy?: 'product' | 'month'; // default: product
}
