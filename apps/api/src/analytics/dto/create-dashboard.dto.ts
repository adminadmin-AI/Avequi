import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsObject } from 'class-validator';

export class CreateDashboardDto {
  @ApiProperty({ description: 'Dashboard name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Dashboard description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Whether this dashboard is shared with the company' })
  @IsOptional()
  @IsBoolean()
  isShared?: boolean;

  @ApiPropertyOptional({ description: 'Grid layout config (react-grid-layout format)' })
  @IsOptional()
  @IsObject()
  layout?: Record<string, any>;
}
