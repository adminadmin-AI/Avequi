import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterConsentDto {
  @ApiProperty({ enum: ['Customer', 'User', 'Supplier'] })
  @IsString()
  subjectType: string;

  @ApiProperty()
  @IsString()
  subjectId: string;

  @ApiProperty({ description: 'CPF ou CNPJ do titular' })
  @IsString()
  document: string;

  @ApiProperty({ enum: ['COMMERCIAL', 'OPERATIONAL', 'ANALYTICS'] })
  @IsString()
  purpose: string;

  @ApiPropertyOptional({ description: 'Base legal LGPD (ex: Art. 7, II — execução de contrato)' })
  @IsOptional()
  @IsString()
  legalBasis?: string;
}
