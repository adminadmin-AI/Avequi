import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { MaintenanceType } from '@prisma/client';

export class CreateMaintenanceOrderDto {
  @IsString()
  equipmentId: string;

  @IsEnum(MaintenanceType)
  @IsOptional()
  type?: MaintenanceType;

  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsOptional()
  scheduledAt?: string;

  @IsString()
  @IsOptional()
  technicianId?: string;
}
