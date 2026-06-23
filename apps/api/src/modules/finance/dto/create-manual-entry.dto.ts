import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateManualEntryDto {
  @IsEnum(['PAYABLE', 'RECEIVABLE'])
  type: 'PAYABLE' | 'RECEIVABLE';

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsDateString()
  @IsNotEmpty()
  dueDate: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  costCenterId?: string;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsEnum(['NONE', 'WEEKLY', 'MONTHLY'])
  recurrence?: 'NONE' | 'WEEKLY' | 'MONTHLY';

  @IsOptional()
  @IsNumber()
  @Min(1)
  recurrenceCount?: number;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;
}
