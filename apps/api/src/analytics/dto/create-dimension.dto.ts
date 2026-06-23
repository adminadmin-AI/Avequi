import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class CreateDimensionDto {
  @ApiProperty({ example: 'sales_rep' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'Representante de Vendas' })
  @IsString()
  displayName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'sales' })
  @IsString()
  dataSource!: string;

  @ApiProperty({ example: 'salesRepId' })
  @IsString()
  field!: string;

  @ApiPropertyOptional({ example: 'region > sales_rep' })
  @IsOptional()
  @IsString()
  hierarchy?: string;
}
