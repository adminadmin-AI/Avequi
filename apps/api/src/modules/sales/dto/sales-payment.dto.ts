import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
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

/** Uma forma de pagamento do plano da venda (#584) — detPag da NF-e é lista */
export class SalesPaymentInputDto {
  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiProperty({ description: 'Valor desta forma (a soma das formas deve fechar o total da venda + frete)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ description: 'Nº de parcelas (cartão crédito/prazo)', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  installments?: number;

  @ApiPropertyOptional({ description: 'Adquirente (obrigatória p/ cartão) — resolve MDR e prazo de liquidação' })
  @IsOptional()
  @IsString()
  acquirerId?: string;

  @ApiPropertyOptional({ description: 'Bandeira (VISA, MASTERCARD...) — tBand do grupo card' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  brand?: string;
}

export class SetSalesPaymentsDto {
  @ApiProperty({ type: [SalesPaymentInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesPaymentInputDto)
  payments: SalesPaymentInputDto[];
}
