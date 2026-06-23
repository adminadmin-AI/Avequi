import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ForecastQueryDto {
  @ApiProperty({
    example: 'sales',
    description: 'sales | inventory | production | financial',
  })
  dataSource!: string;

  @ApiProperty({ example: 'revenue' })
  metric!: string;

  @ApiProperty({ example: 12, description: 'Number of periods to forecast' })
  periods!: number;

  @ApiPropertyOptional({ example: 12, description: 'Season length override' })
  seasonLength?: number;

  @ApiPropertyOptional({ example: { periodFrom: '2026-01-01', periodTo: '2026-06-30' } })
  filters?: {
    periodFrom?: string;
    periodTo?: string;
  };
}
