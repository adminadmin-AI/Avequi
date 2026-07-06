import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const onlyDigitsOrUndefined = ({ value }: { value: unknown }) => {
  if (value == null) return undefined;
  const d = String(value).replace(/\D/g, '');
  return d || undefined;
};

/** Transportadora — grupo transp da NF-e (#481) */
export class CreateCarrierDto {
  @ApiProperty({ description: 'Nome fantasia' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Razão social (xNome do transportador na NF-e)' })
  @IsOptional()
  @IsString()
  razaoSocial?: string;

  @ApiPropertyOptional({ description: 'CNPJ (14) ou CPF (11), com ou sem máscara' })
  @Transform(onlyDigitsOrUndefined)
  @IsOptional()
  @Matches(/^(\d{11}|\d{14})$/, { message: 'Documento deve ser CPF (11) ou CNPJ (14 dígitos)' })
  document?: string;

  @ApiPropertyOptional({ description: 'Inscrição estadual' })
  @Transform(onlyDigitsOrUndefined)
  @IsOptional()
  @IsString()
  ie?: string;

  @ApiPropertyOptional({ description: 'Endereço (logradouro + número — campo único xEnder da NF-e)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2)
  state?: string;

  @ApiPropertyOptional({ description: 'Placa padrão do veículo (ex: ABC1D23)' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  vehiclePlate?: string;

  @ApiPropertyOptional({ description: 'UF da placa' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  vehiclePlateState?: string;

  @ApiPropertyOptional({ description: 'RNTC — registro ANTT do transportador de carga' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  rntc?: string;
}
