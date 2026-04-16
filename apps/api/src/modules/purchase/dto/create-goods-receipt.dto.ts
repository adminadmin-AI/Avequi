import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CreateGRItemDto {
  @IsString()
  @IsNotEmpty()
  poItemId: string;

  @IsNumber()
  @IsPositive()
  qtyReceived: number;

  @IsOptional()
  @IsString()
  divergenceReason?: string;
}

export class CreateGoodsReceiptDto {
  @IsString()
  @IsNotEmpty()
  purchaseOrderId: string;

  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGRItemDto)
  items: CreateGRItemDto[];
}
