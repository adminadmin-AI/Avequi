import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaxRegime } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * POST /ops/tenants — OPS WP2 (#909), passo 1 do onboarding.
 * Cria a empresa RAIZ do tenant novo (nasce TRIAL). Dados fiscais mínimos
 * para operar; o restante (endereço completo, IE etc.) pode ser completado
 * pelo próprio admin do tenant depois, dentro do app.
 */
export class CreateTenantDto {
  @ApiProperty({ example: 'CRD Implementos' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: '12345678000199', description: 'Somente dígitos' })
  @Matches(/^\d{14}$/, { message: 'cnpj deve ter exatamente 14 dígitos' })
  cnpj: string;

  @ApiProperty({ example: 'CRD Implementos Rodoviários LTDA' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  razaoSocial: string;

  @ApiPropertyOptional({ description: 'Inscrição Estadual' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  ie?: string;

  @ApiPropertyOptional({
    description: 'Código Regime Tributário: 1=SN, 2=SN-ExSub, 3=Normal',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3])
  crt?: number;

  @ApiPropertyOptional({ enum: TaxRegime })
  @IsOptional()
  @IsEnum(TaxRegime)
  taxRegime?: TaxRegime;

  @ApiPropertyOptional({ example: 'PR', description: 'UF (2 letras)' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'state deve ser a UF em 2 letras maiúsculas' })
  state?: string;

  @ApiPropertyOptional({ example: 'Curitiba' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ example: 'contato@crd.com.br' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  email?: string;
}
