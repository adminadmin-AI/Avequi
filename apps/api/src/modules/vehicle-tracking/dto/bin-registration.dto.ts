import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { BinRegistrationStatus } from '@prisma/client';

export class CreateBinRegistrationDto {
  @ApiProperty({ description: 'ID do SerialNumber (chassi) a rastrear' })
  @IsString()
  serialNumberId: string;

  @ApiPropertyOptional({ description: 'Número do registro na BIN (quando já houver)' })
  @IsOptional()
  @IsString()
  binNumber?: string;

  @ApiPropertyOptional({ enum: BinRegistrationStatus, default: BinRegistrationStatus.PENDING })
  @IsOptional()
  @IsEnum(BinRegistrationStatus)
  status?: BinRegistrationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBinRegistrationDto extends PartialType(CreateBinRegistrationDto) {
  @ApiPropertyOptional({ description: 'Motivo de rejeição (obrigatório quando status=REJECTED)' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
