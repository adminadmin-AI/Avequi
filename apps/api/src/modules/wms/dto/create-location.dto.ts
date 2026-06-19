import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { LocationType } from '@prisma/client';

export class CreateLocationDto {
  @IsString() @IsNotEmpty() companyId: string;
  @IsString() @IsNotEmpty() warehouseId: string;
  @IsString() @IsNotEmpty() code: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(LocationType) @IsOptional() type?: LocationType;
}
