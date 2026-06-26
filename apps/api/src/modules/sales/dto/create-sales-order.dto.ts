import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSaleItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() productId: string;
  @ApiProperty() @IsNumber() @IsPositive() quantity: number;
  @ApiProperty() @IsNumber() @IsPositive() unitPrice: number;
  @ApiPropertyOptional() @IsString() @IsOptional() unit?: string;
}

export class CreateSalesOrderDto {
  @ApiProperty() @IsString() @IsNotEmpty() warehouseId: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;

  @ApiProperty({ type: [CreateSaleItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items: CreateSaleItemDto[];
}
