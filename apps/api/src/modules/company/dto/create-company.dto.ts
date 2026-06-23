import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CompanyType, TaxRegime } from '@prisma/client';

export class CreateCompanyDto {
  @ApiProperty({ example: 'GDR Matriz' })
  @IsString()
  name: string;

  @ApiProperty({ example: '12.345.678/0001-90' })
  @IsString()
  cnpj: string;

  @ApiProperty({ enum: CompanyType, example: CompanyType.MATRIZ })
  @IsEnum(CompanyType)
  type: CompanyType;

  @ApiPropertyOptional({ example: 'cuid-da-empresa-pai' })
  @IsOptional()
  @IsString()
  parentId?: string;

  // ── Dados fiscais ──

  @ApiPropertyOptional({ example: 'GDR Reboques Indústria e Comércio Ltda' })
  @IsOptional()
  @IsString()
  razaoSocial?: string;

  @ApiPropertyOptional({ example: '123456789', description: 'Inscrição Estadual' })
  @IsOptional()
  @IsString()
  ie?: string;

  @ApiPropertyOptional({ example: '12345', description: 'Inscrição Municipal' })
  @IsOptional()
  @IsString()
  im?: string;

  @ApiPropertyOptional({
    example: 3,
    description: 'Código Regime Tributário: 1=SN, 2=SN-ExSub, 3=Normal',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  crt?: number;

  @ApiPropertyOptional({ enum: TaxRegime, example: TaxRegime.LUCRO_PRESUMIDO })
  @IsOptional()
  @IsEnum(TaxRegime)
  taxRegime?: TaxRegime;

  @ApiPropertyOptional({ example: '1234567890', description: 'Inscrição SUFRAMA' })
  @IsOptional()
  @IsString()
  suframa?: string;

  @ApiPropertyOptional({ example: '2930101', description: 'CNAE principal' })
  @IsOptional()
  @IsString()
  cnae?: string;

  // ── Endereço ──

  @ApiPropertyOptional({ example: 'Rua das Indústrias' })
  @IsOptional()
  @IsString()
  street?: string;

  @ApiPropertyOptional({ example: '1500' })
  @IsOptional()
  @IsString()
  number?: string;

  @ApiPropertyOptional({ example: 'Galpão 3' })
  @IsOptional()
  @IsString()
  complement?: string;

  @ApiPropertyOptional({ example: 'Distrito Industrial' })
  @IsOptional()
  @IsString()
  neighborhood?: string;

  @ApiPropertyOptional({ example: 'Cascavel' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'PR', description: 'UF (2 letras)' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'state deve ser UF com 2 letras maiúsculas' })
  state?: string;

  @ApiPropertyOptional({ example: '85807-030', description: 'CEP' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'zipCode deve estar no formato 00000-000' })
  zipCode?: string;

  @ApiPropertyOptional({ example: '4106902', description: 'Código IBGE do município' })
  @IsOptional()
  @IsString()
  ibgeCode?: string;

  @ApiPropertyOptional({ example: '(45) 3222-1234' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'fiscal@gdr.com.br' })
  @IsOptional()
  @IsString()
  email?: string;
}
