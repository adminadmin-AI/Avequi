import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateProductionLogDto {
  @IsNumber()
  @IsPositive()
  qty: number;

  @IsOptional()
  @IsString()
  routingStepId?: string;

  @IsOptional()
  @IsString()
  workCenter?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
