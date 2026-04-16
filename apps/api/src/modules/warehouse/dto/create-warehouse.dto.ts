import { IsOptional, IsString } from 'class-validator';

export class CreateWarehouseDto {
  @IsString()
  companyId: string;

  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  description?: string;
}
