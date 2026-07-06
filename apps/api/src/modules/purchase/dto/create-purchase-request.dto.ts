import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePurchaseRequestDto {
  @ApiProperty()
  @IsString()
  productId: string;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString()
  neededBy?: string;

  @ApiPropertyOptional({ example: 'Reposição de estoque crítico' })
  @IsOptional()
  @IsString()
  justification?: string;
}
