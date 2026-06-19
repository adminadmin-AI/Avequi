import { IsEnum, IsOptional, IsString } from 'class-validator';
import { InspectionType } from '@prisma/client';

export class CreateInspectionDto {
  @IsEnum(InspectionType)
  type: InspectionType;

  @IsOptional()
  @IsString()
  goodsReceiptId?: string;

  @IsOptional()
  @IsString()
  productionOrderId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
