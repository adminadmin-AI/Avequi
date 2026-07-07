import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateSupplierAdvanceDto {
  @ApiProperty() @IsString() @IsNotEmpty() supplierId: string;

  @ApiProperty({ example: 15000, description: 'Valor adiantado (R$)' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ description: 'PO vinculada (opcional)' })
  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;

  @ApiPropertyOptional({ description: 'Data do pagamento do adiantamento (default: agora)' })
  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
