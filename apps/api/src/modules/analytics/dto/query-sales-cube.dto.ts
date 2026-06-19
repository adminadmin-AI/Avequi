import { IsOptional, IsString, IsDateString } from 'class-validator';

export class QuerySalesCubeDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  groupBy?: 'product' | 'customer' | 'month' | 'status'; // default: month
}
