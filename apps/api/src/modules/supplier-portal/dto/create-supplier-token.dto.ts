import { IsOptional, IsString, IsDateString } from 'class-validator';

export class CreateSupplierTokenDto {
  @IsString()
  supplierId: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
