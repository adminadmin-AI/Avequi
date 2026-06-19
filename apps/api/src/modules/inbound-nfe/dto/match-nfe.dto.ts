import { IsString } from 'class-validator';

export class MatchNfeDto {
  @IsString()
  purchaseOrderId: string;
}
