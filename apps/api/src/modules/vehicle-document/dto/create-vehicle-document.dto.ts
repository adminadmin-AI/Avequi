import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateVehicleDocumentDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsIn(['CAT', 'CCT', 'TECHNICAL_PROJECT'])
  type: string;

  @IsString()
  @IsNotEmpty()
  documentNumber: string;

  @IsDateString()
  issuedAt: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'EXPIRED', 'REVOKED'])
  status?: string;
}
