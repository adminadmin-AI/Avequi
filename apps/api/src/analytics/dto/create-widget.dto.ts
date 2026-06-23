import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsObject, IsOptional, IsInt, Min } from 'class-validator';

export enum WidgetType {
  KPI_CARD = 'KPI_CARD',
  LINE_CHART = 'LINE_CHART',
  BAR_CHART = 'BAR_CHART',
  PIE_CHART = 'PIE_CHART',
  TABLE = 'TABLE',
  GAUGE = 'GAUGE',
}

export class WidgetPositionDto {
  @ApiProperty() x: number;
  @ApiProperty() y: number;
  @ApiProperty() w: number;
  @ApiProperty() h: number;
}

export class CreateWidgetDto {
  @ApiProperty({ enum: WidgetType })
  @IsEnum(WidgetType)
  type: WidgetType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'Widget config: { dataSource, metric, filters, period, groupBy, limit, comparison }',
    example: {
      dataSource: 'sales',
      metric: 'revenue',
      period: { start: '2026-01-01', end: '2026-06-30' },
    },
  })
  @IsObject()
  config: Record<string, any>;

  @ApiProperty({ description: 'Grid position: { x, y, w, h }' })
  @IsObject()
  position: WidgetPositionDto;

  @ApiPropertyOptional({ description: 'Auto-refresh interval in seconds (null = manual)' })
  @IsOptional()
  @IsInt()
  @Min(10)
  refreshInterval?: number;
}
