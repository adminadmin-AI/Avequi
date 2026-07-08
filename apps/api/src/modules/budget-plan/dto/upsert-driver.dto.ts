import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpsertDriverDto {
  // Presente = atualiza o driver; ausente = cria novo
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsNumber()
  @Min(0)
  volume: number;

  @IsNumber()
  @Min(0)
  avgPrice: number;

  @IsNumber()
  @Min(0)
  unitCost: number;
}
