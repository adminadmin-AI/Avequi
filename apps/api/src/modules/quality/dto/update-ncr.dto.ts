import { IsOptional, IsString, IsDateString } from 'class-validator';

export class UpdateNcrDto {
  @IsOptional()
  @IsString()
  rootCause?: string;

  @IsOptional()
  @IsString()
  correctiveAction?: string;

  @IsOptional()
  @IsString()
  responsibleId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
