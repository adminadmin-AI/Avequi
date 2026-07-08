import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateVehicleDocumentDto {
  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'EXPIRED', 'REVOKED'])
  status?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;
}
