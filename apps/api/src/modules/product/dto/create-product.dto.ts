import { IsString, IsEnum, IsOptional, IsIn, IsNumber, IsPositive, Matches, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType, UnitOfMeasure } from '@prisma/client';

/** Mantém só dígitos; string vazia vira undefined (p/ @IsOptional funcionar com '' do form) */
const onlyDigitsOrUndefined = ({ value }: { value: unknown }) => {
  if (value == null) return undefined;
  const d = String(value).replace(/\D/g, '');
  return d || undefined;
};

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  sku: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ProductType })
  @IsEnum(ProductType)
  type: ProductType;

  @ApiPropertyOptional({ enum: UnitOfMeasure })
  @IsOptional()
  @IsEnum(UnitOfMeasure)
  unit?: UnitOfMeasure;

  @ApiPropertyOptional({ description: 'NCM — 8 dígitos (aceita máscara 0000.00.00) (#484)' })
  @Transform(onlyDigitsOrUndefined)
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'NCM deve ter 8 dígitos' })
  ncm?: string;

  @ApiPropertyOptional({ description: 'Origem da mercadoria 0-8 (tabela A do ICMS) — orig da NF-e; 1/2/3/8 = importado → interestadual 4% (#480)' })
  @IsOptional()
  @IsIn(['0', '1', '2', '3', '4', '5', '6', '7', '8'])
  origem?: string;

  @ApiPropertyOptional({ description: 'GTIN/EAN (cEAN) — vazio emite SEM GTIN (#484)' })
  @Transform(onlyDigitsOrUndefined)
  @IsOptional()
  @Matches(/^(\d{8}|\d{12,14})$/, { message: 'GTIN deve ter 8, 12, 13 ou 14 dígitos' })
  ean?: string;

  @ApiPropertyOptional({ description: 'Código CEST — 7 dígitos, quando sujeito a ST (#484)' })
  @Transform(onlyDigitsOrUndefined)
  @IsOptional()
  @Matches(/^\d{7}$/, { message: 'CEST deve ter 7 dígitos' })
  cest?: string;

  @ApiPropertyOptional({ description: 'Peso líquido unitário em kg — alimenta volumes da NF-e (#484)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pesoLiquido?: number;

  @ApiPropertyOptional({ description: 'Peso bruto unitário em kg (#484)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pesoBruto?: number;

  @ApiPropertyOptional({ description: 'Unidade tributável (uTrib) quando ≠ unidade comercial (#484)' })
  @IsOptional()
  @IsString()
  unidadeTributavel?: string;

  @ApiPropertyOptional({ description: 'Fator de conversão: qTrib = qCom × fator (#484)' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  fatorConversaoTributavel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  costPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  salePrice?: number;
}
