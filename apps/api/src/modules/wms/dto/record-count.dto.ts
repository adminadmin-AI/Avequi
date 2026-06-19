import { IsNumber, Min } from 'class-validator';

export class RecordCountDto {
  @IsNumber()
  @Min(0)
  countedQty: number;
}
