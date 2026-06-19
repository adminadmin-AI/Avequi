import { IsNumber, IsString, Min } from 'class-validator';

export class AdjustBatchDto {
  @IsNumber()
  @Min(0)
  quantity: number;

  @IsString()
  notes: string;
}
