import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsInt, IsBoolean, Min } from 'class-validator';

export class CreateSlaDefinitionDto {
  @ApiProperty({ example: 'PURCHASE_ORDER' })
  @IsString()
  @IsNotEmpty()
  entityType: string;

  @ApiProperty({ example: 'PENDING' })
  @IsString()
  @IsNotEmpty()
  statusFrom: string;

  @ApiProperty({ example: 'APPROVED' })
  @IsString()
  @IsNotEmpty()
  statusTo: string;

  @ApiProperty({ example: 48, description: 'Maximum duration in hours' })
  @IsInt()
  @Min(1)
  maxDurationHours: number;

  @ApiPropertyOptional({ example: 'DIRECTOR' })
  @IsString()
  @IsOptional()
  escalateToRole?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
