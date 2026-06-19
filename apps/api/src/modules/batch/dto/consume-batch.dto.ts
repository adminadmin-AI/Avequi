import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ConsumeBatchDto {
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsString()
  productionOrderId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
