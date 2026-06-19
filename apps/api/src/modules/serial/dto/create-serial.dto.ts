import { IsString, IsOptional, IsEnum } from 'class-validator';
import { SerialStatus } from '@prisma/client';

export class CreateSerialDto {
  @IsString()
  serial: string;

  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsEnum(SerialStatus)
  status?: SerialStatus;

  @IsOptional()
  @IsString()
  productionOrderId?: string;

  @IsOptional()
  @IsString()
  observations?: string;
}
