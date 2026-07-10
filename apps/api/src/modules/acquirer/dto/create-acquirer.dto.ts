import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentGateway } from '@prisma/client';

const onlyDigitsOrUndefined = ({ value }: { value: unknown }) => {
  if (value == null) return undefined;
  const d = String(value).replace(/\D/g, '');
  return d || undefined;
};

/** Adquirente/credenciadora de cartão (#585) */
export class CreateAcquirerDto {
  @ApiProperty({ description: 'Nome (Cielo, Rede, Stone...)' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'CNPJ da credenciadora (grupo card da NF-e)', example: '01027058000191' })
  @IsOptional()
  @Transform(onlyDigitsOrUndefined)
  @Matches(/^\d{14}$/, { message: 'cnpj deve ter 14 dígitos' })
  cnpj?: string;

  @ApiPropertyOptional({
    description: 'TEF/gateway que autoriza as transações desta adquirente (#596). MOCK = não integrada.',
    enum: PaymentGateway,
    default: PaymentGateway.MOCK,
  })
  @IsOptional()
  @IsEnum(PaymentGateway)
  gateway?: PaymentGateway;
}
