import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { SalesPaymentInputDto } from './sales-payment.dto';

export class CreateSaleItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() productId: string;
  @ApiProperty() @IsNumber() @IsPositive() quantity: number;
  @ApiProperty() @IsNumber() @IsPositive() unitPrice: number;
  @ApiPropertyOptional() @IsString() @IsOptional() unit?: string;
}

export class CreateSalesOrderDto {
  @ApiProperty() @IsString() @IsNotEmpty() warehouseId: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, description: 'Forma de pagamento — vira o detPag da NF-e (#479)' })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Endereço de entrega do cliente (CustomerAddress) — grupo <entrega> da NF-e (#474)' })
  @IsOptional()
  @IsString()
  deliveryAddressId?: string;

  // ─── Frete e transporte → grupo transp da NF-e (#481) ─────────────────────

  @ApiPropertyOptional({ description: 'modFrete: 0-CIF 1-FOB 2-terceiros 3-próprio remetente 4-próprio destinatário 9-sem frete (default)' })
  @IsOptional()
  @IsIn(['0', '1', '2', '3', '4', '9'])
  freightModality?: string;

  @ApiPropertyOptional({ description: 'Valor do frete (vFrete)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  freightValue?: number;

  @ApiPropertyOptional({ description: 'Transportadora (Carrier) — grupo transportador da NF-e' })
  @IsOptional()
  @IsString()
  carrierId?: string;

  @ApiPropertyOptional({ description: 'Quantidade de volumes (qVol) — vazio = 1 por unidade vendida' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  volumesQuantity?: number;

  @ApiPropertyOptional({ description: 'Espécie dos volumes (esp), ex: REBOQUE' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  volumesSpecies?: string;

  @ApiProperty({ type: [CreateSaleItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items: CreateSaleItemDto[];

  @ApiPropertyOptional({
    type: [SalesPaymentInputDto],
    description: 'Plano de pagamento — 1+ formas; soma deve fechar itens + frete (#584)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesPaymentInputDto)
  payments?: SalesPaymentInputDto[];
}
