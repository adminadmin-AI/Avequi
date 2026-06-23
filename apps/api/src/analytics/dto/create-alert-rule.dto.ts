import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type AlertRuleOperatorType = 'GT' | 'GTE' | 'LT' | 'LTE' | 'ANOMALY';

export class CreateAlertRuleDto {
  @ApiProperty({ example: 'Revenue Drop Alert' })
  name!: string;

  @ApiProperty({ example: 'revenue', description: 'metric field name in fact table' })
  metric!: string;

  @ApiProperty({
    example: 'sales',
    description: 'sales | inventory | production | financial',
  })
  dataSource!: string;

  @ApiProperty({ enum: ['GT', 'GTE', 'LT', 'LTE', 'ANOMALY'] })
  operator!: AlertRuleOperatorType;

  @ApiPropertyOptional({ example: 50000 })
  threshold?: number;

  @ApiPropertyOptional({ example: 30 })
  windowDays?: number;

  @ApiPropertyOptional({ example: ['DIRECTOR', 'MANAGER'], type: [String] })
  notifyRoles?: string[];
}
