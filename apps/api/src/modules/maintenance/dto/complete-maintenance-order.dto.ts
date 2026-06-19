import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CompleteMaintenanceOrderDto {
  @IsString()
  resolution: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  cost?: number;
}
