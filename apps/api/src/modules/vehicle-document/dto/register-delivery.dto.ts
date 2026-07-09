import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RegisterDeliveryDto {
  @IsString()
  @IsNotEmpty()
  salesOrderId: string;

  @IsOptional()
  @IsString()
  serialNumberId?: string;

  @IsIn(['RESELLER', 'END_CUSTOMER'])
  deliveredTo: string;

  @IsOptional()
  @IsDateString()
  deliveredAt?: string;

  @IsOptional()
  @IsString()
  deliveredBy?: string;
}
