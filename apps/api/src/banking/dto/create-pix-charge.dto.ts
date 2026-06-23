import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  Min,
} from 'class-validator';

export class CreatePixChargeDto {
  @ApiProperty({ description: 'ID da conta bancária' })
  @IsString()
  bankAccountId: string;

  @ApiPropertyOptional({ description: 'ID do título a receber vinculado' })
  @IsOptional()
  @IsString()
  receivableId?: string;

  @ApiProperty({ description: 'Valor da cobrança em reais', example: 150.0 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'Descrição da cobrança' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Chave Pix (e-mail, CPF, CNPJ, telefone, EVP)' })
  @IsString()
  pixKey: string;

  @ApiPropertyOptional({ description: 'Data/hora de expiração (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
