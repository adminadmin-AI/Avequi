import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class ExportQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dashboardId?: string;

  @ApiProperty({ example: 'CSV', enum: ['CSV', 'XLSX', 'HTML'] })
  @IsString()
  format!: string;
}
