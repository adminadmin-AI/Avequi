import { IsOptional, IsString } from 'class-validator';

export class UpdateInspectionDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  inspectedById?: string;
}
