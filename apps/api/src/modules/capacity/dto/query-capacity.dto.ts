import { IsDateString, IsOptional, IsString } from 'class-validator';

export class QueryCapacityDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsString()
  workCenterCode?: string;
}
