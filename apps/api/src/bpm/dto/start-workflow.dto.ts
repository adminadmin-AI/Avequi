import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class StartWorkflowDto {
  @ApiProperty({ example: 'PURCHASE_ORDER' })
  @IsString()
  @IsNotEmpty()
  entityType: string;

  @ApiProperty({ example: 'po-123' })
  @IsString()
  @IsNotEmpty()
  entityId: string;

  @ApiPropertyOptional({ example: { totalAmount: 15000, supplierId: 'sup-1' } })
  @IsObject()
  @IsOptional()
  variables?: Record<string, any>;
}
