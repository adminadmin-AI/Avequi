import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateDeliveryStatusDto {
  @IsIn(['AWAITING_BIN', 'AWAITING_PICKUP', 'IN_TRANSIT', 'DELIVERED', 'RETURNED'])
  status: string;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsString()
  transporterName?: string;

  @IsOptional()
  @IsString()
  transporterCnpj?: string;

  @IsOptional()
  @IsString()
  vehiclePlate?: string;

  @IsOptional()
  @IsString()
  receivedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
