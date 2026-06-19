import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { SerialStatus } from '@prisma/client';

export class UpdateSerialDto {
  @IsOptional()
  @IsEnum(SerialStatus)
  status?: SerialStatus;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  observations?: string;

  @IsOptional()
  @IsDateString()
  engravingStartedAt?: string;

  @IsOptional()
  @IsDateString()
  engravingDoneAt?: string;

  @IsOptional()
  @IsString()
  engravingOperator?: string;
}
