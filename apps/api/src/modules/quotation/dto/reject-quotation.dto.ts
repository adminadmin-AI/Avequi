import { IsOptional, IsString } from 'class-validator';

export class RejectQuotationDto {
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
