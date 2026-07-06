import { IsEmail, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaxRegime } from '@prisma/client';

const onlyDigitsOrUndefined = ({ value }: { value: unknown }) => {
  if (value == null) return undefined;
  const d = String(value).replace(/\D/g, '');
  return d || undefined;
};

export class CreateSupplierDto {
  @ApiProperty({ description: 'Nome fantasia / apelido comercial' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Razão social (#478)' })
  @IsOptional()
  @IsString()
  razaoSocial?: string;

  @ApiPropertyOptional()
  @Transform(onlyDigitsOrUndefined)
  @IsOptional()
  @IsString()
  cnpj?: string;

  @ApiPropertyOptional({ description: 'Inscrição estadual (#478)' })
  @Transform(onlyDigitsOrUndefined)
  @IsOptional()
  @IsString()
  ie?: string;

  @ApiPropertyOptional({ enum: TaxRegime, description: 'Regime tributário — crédito IBS/CBS nas compras a partir de 2027 (#478)' })
  @IsOptional()
  @IsEnum(TaxRegime)
  taxRegime?: TaxRegime;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'E-mail p/ NF-e/boleto (fallback: email) (#478)' })
  @IsOptional()
  @IsEmail()
  fiscalEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional({ description: 'Logradouro (#478)' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  complement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  neighborhood?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2)
  state?: string;

  @ApiPropertyOptional()
  @Transform(onlyDigitsOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(8)
  zipCode?: string;

  @ApiPropertyOptional({ description: 'Código IBGE do município' })
  @Transform(onlyDigitsOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(7)
  ibgeCode?: string;

  @ApiPropertyOptional({ description: 'Condição de pagamento padrão — pré-preenche PO (#478)' })
  @IsOptional()
  @IsString()
  defaultPaymentTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAgency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAccount?: string;

  @ApiPropertyOptional({ description: 'Chave PIX para pagamento' })
  @IsOptional()
  @IsString()
  pixKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;
}
