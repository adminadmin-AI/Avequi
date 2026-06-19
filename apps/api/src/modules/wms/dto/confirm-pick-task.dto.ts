import { IsOptional, IsString } from 'class-validator';

export class ConfirmPickTaskDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
