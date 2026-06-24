import { IsString, IsOptional, IsBoolean, IsDateString, IsEnum, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class PriceTableItemDto {
  @IsString()
  productId: string;

  @IsNumber()
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  minQuantity?: number;

  @IsOptional()
  @IsNumber()
  discountPercent?: number;
}

export class CreatePriceTableDto {
  @IsString()
  companyId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsDateString()
  validFrom: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceTableItemDto)
  items?: PriceTableItemDto[];
}
