import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateEquipmentDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsDateString()
  @IsOptional()
  acquisitionDate?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maintenanceIntervalDays?: number;

  @IsDateString()
  @IsOptional()
  nextMaintenanceAt?: string;
}
