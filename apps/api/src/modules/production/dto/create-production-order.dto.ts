import { IsOptional, IsString, IsNumber, IsPositive, IsDateString } from 'class-validator';

export class CreateProductionOrderDto {
  @IsString()
  companyId: string;

  @IsString()
  productId: string;

  @IsString()
  warehouseId: string;

  @IsNumber()
  @IsPositive()
  plannedQty: number;

  @IsOptional()
  @IsString()
  mrpSuggestionId?: string;

  @IsOptional()
  @IsDateString()
  scheduledStart?: string;

  @IsOptional()
  @IsDateString()
  scheduledEnd?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
