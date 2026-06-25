import { MovementType } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateMovementDto {
  @IsString()
  warehouseId: string;

  @IsString()
  productId: string;

  @IsEnum(MovementType)
  type: MovementType;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsString()
  @MinLength(3)
  reason: string;

  @IsOptional()
  @IsString()
  reference?: string;
}
