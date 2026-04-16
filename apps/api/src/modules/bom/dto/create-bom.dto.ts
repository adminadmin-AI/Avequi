import { Type } from 'class-transformer';
import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, Min, IsPositive } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BomItemDto {
  @ApiProperty() @IsString() componentId: string;
  @ApiProperty() @IsNumber() @IsPositive() quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) scrapPct?: number;
}

export class CreateBomDto {
  @ApiProperty() @IsString() productId: string;
  @ApiProperty() @IsString() companyId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [BomItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomItemDto)
  items: BomItemDto[];
}
