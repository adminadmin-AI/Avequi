import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { TaxOperationType, ProductType } from '@prisma/client';

export class CreateTaxRuleDto {
  @ApiProperty({ enum: TaxOperationType, example: TaxOperationType.VENDA_INTERNA })
  @IsEnum(TaxOperationType)
  operationType: TaxOperationType;

  @ApiPropertyOptional({ example: '87161000', description: 'NCM específico (null = qualquer)' })
  @IsOptional()
  @IsString()
  ncm?: string;

  @ApiPropertyOptional({ enum: ProductType, description: 'Tipo de produto (null = qualquer)' })
  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  @ApiPropertyOptional({ example: 'PR', description: 'UF origem (null = qualquer)' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'ufOrigem deve ser UF com 2 letras' })
  ufOrigem?: string;

  @ApiPropertyOptional({ example: 'SP', description: 'UF destino (null = qualquer)' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'ufDestino deve ser UF com 2 letras' })
  ufDestino?: string;

  @ApiProperty({ example: '5101', description: 'CFOP' })
  @IsString()
  cfop: string;

  // ICMS
  @ApiProperty({ example: '00', description: 'CST ICMS' })
  @IsString()
  icmsCst: string;

  @ApiProperty({ example: 18, description: 'Alíquota ICMS (%)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  icmsAliquota: number;

  @ApiPropertyOptional({ example: 100, description: '% base de cálculo ICMS (100 = sem redução)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  icmsBaseReducao?: number;

  // IPI
  @ApiPropertyOptional({ example: '50', description: 'CST IPI' })
  @IsOptional()
  @IsString()
  ipiCst?: string;

  @ApiPropertyOptional({ example: 5, description: 'Alíquota IPI (%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  ipiAliquota?: number;

  // PIS
  @ApiPropertyOptional({ example: '01', description: 'CST PIS' })
  @IsOptional()
  @IsString()
  pisCst?: string;

  @ApiPropertyOptional({ example: 0.65, description: 'Alíquota PIS (%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  pisAliquota?: number;

  // COFINS
  @ApiPropertyOptional({ example: '01', description: 'CST COFINS' })
  @IsOptional()
  @IsString()
  cofinsCst?: string;

  @ApiPropertyOptional({ example: 3, description: 'Alíquota COFINS (%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cofinsAliquota?: number;

  @ApiPropertyOptional({ example: 'Venda interna PR padrão' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 0, description: 'Prioridade (maior = mais específica)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
