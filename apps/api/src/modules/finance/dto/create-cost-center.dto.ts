import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCostCenterDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}
