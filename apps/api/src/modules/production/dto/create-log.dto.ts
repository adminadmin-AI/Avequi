import { IsDateString, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class CreateProductionLogDto {
  @IsNumber()
  @IsPositive()
  qty: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  scrapQuantity?: number;

  @IsOptional()
  @IsString()
  scrapReason?: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsOptional()
  @IsString()
  routingStepId?: string;

  @IsOptional()
  @IsString()
  workCenter?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
