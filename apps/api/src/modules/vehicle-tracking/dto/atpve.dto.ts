import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { AtpveStatus } from '@prisma/client';

export class CreateAtpveDto {
  @ApiProperty({ description: 'ID do SerialNumber (chassi)' })
  @IsString()
  serialNumberId: string;

  @ApiProperty({ description: 'ID da ordem de venda' })
  @IsString()
  salesOrderId: string;

  @ApiProperty({ description: 'CPF do cliente final (somente dígitos)', example: '12345678909' })
  @Matches(/^\d{11}$/, { message: 'clienteCpf deve ter 11 dígitos' })
  clienteCpf: string;

  @ApiProperty({ description: 'Nome do cliente final' })
  @IsString()
  clienteNome: string;

  @ApiPropertyOptional({ description: 'Número do ATPV-e (quando já emitido)' })
  @IsOptional()
  @IsString()
  atpveNumber?: string;

  @ApiPropertyOptional({ enum: AtpveStatus, default: AtpveStatus.PENDING })
  @IsOptional()
  @IsEnum(AtpveStatus)
  status?: AtpveStatus;

  @ApiPropertyOptional({ description: 'Quem emitiu na Revenda (RENAVE)' })
  @IsOptional()
  @IsString()
  issuedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateAtpveDto extends PartialType(CreateAtpveDto) {}
