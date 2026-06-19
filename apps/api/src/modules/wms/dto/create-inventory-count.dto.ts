import { IsEnum, IsOptional, IsString, IsArray, ArrayNotEmpty } from 'class-validator';

export enum InventoryCountTypeDto {
  CYCLIC = 'CYCLIC',
  FULL = 'FULL',
}

export class CreateInventoryCountDto {
  @IsString()
  warehouseId: string;

  @IsEnum(InventoryCountTypeDto)
  type: InventoryCountTypeDto;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Para CYCLIC: lista de productIds a contar. Para FULL: omitir (conta tudo). */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  productIds?: string[];
}
