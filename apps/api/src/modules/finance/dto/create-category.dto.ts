import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsEnum(['REVENUE', 'EXPENSE', 'TRANSFER', 'GROUP'])
  type: 'REVENUE' | 'EXPENSE' | 'TRANSFER' | 'GROUP';

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  dreCode?: string;
}
