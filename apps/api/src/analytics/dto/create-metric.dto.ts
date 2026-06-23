import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class CreateMetricDto {
  @ApiProperty({ example: 'avg_cost' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'Custo Médio' })
  @IsString()
  displayName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'sales' })
  @IsString()
  dataSource!: string;

  @ApiProperty({ example: 'AVG(costPrice)' })
  @IsString()
  expression!: string;

  @ApiPropertyOptional({ example: 'BRL' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ example: 'currency' })
  @IsOptional()
  @IsString()
  format?: string;

  @ApiPropertyOptional({ example: 'FINANCIAL' })
  @IsOptional()
  @IsString()
  category?: string;
}
