import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * Override opcional de seleção de chassis por produto no despacho (#628).
 * Quando ausente, o dispatch escolhe os chassis por FIFO (createdAt asc).
 * Quando presente, usa exatamente os serials informados (ex.: operador escaneia).
 */
export class DispatchItemSerialsDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  serialIds: string[];
}

export class DispatchTransferDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispatchItemSerialsDto)
  serials?: DispatchItemSerialsDto[];
}
