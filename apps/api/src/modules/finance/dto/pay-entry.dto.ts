import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class PayEntryDto {
  @IsDateString()
  @IsNotEmpty()
  paidAt: string;

  @IsNumber()
  @Min(0.01)
  paidAmount: number;

  @IsOptional()
  @IsString()
  paymentNote?: string;
}
