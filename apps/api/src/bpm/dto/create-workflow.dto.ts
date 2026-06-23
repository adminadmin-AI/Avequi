import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateWorkflowDto {
  @ApiProperty({ example: 'Aprovação de Ordem de Compra' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'PURCHASE_ORDER' })
  @IsString()
  @IsNotEmpty()
  entityType: string;

  @ApiPropertyOptional({ example: 'Fluxo de aprovação para ordens de compra acima de R$10.000' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'purchase-order.created' })
  @IsString()
  @IsOptional()
  triggerEvent?: string;
}
