import { IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';
import { NcrSeverity } from '@prisma/client';

export class CreateNcrDto {
  @IsOptional()
  @IsString()
  inspectionId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsEnum(NcrSeverity)
  severity?: NcrSeverity;

  @IsOptional()
  @IsString()
  rootCause?: string;

  @IsOptional()
  @IsString()
  correctiveAction?: string;

  @IsOptional()
  @IsString()
  responsibleId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
