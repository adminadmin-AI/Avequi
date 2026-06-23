import { PartialType } from '@nestjs/swagger';
import { CreateDashboardDto } from './create-dashboard.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsObject } from 'class-validator';

export class UpdateDashboardDto extends PartialType(CreateDashboardDto) {
  @ApiPropertyOptional({ description: 'Updated grid layout config' })
  @IsOptional()
  @IsObject()
  layout?: Record<string, any>;
}
