import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { EquipmentStatus } from '@prisma/client';

export class UpdateEquipmentDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsEnum(EquipmentStatus)
  @IsOptional()
  status?: EquipmentStatus;

  @IsInt()
  @Min(1)
  @IsOptional()
  maintenanceIntervalDays?: number;

  @IsDateString()
  @IsOptional()
  nextMaintenanceAt?: string;
}
