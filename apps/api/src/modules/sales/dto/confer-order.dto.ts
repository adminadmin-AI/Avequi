import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConferItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() saleItemId: string;
  @ApiProperty({ description: 'Quantidade fisicamente conferida' }) @IsNumber() quantity: number;
  @ApiPropertyOptional({ description: 'Re-scan do chassi — deve bater com o serial da separação (#491)' })
  @IsOptional() @IsString() serialNumberId?: string;
}

/** Conferência da carga — dupla checagem entre separação e faturamento (#491) */
export class ConferOrderDto {
  @ApiProperty({ type: [ConferItemDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ConferItemDto)
  items: ConferItemDto[];
}
