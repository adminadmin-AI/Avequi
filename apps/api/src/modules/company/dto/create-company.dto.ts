import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CompanyType } from '@prisma/client';

export class CreateCompanyDto {
  @ApiProperty({ example: 'GDR Matriz' })
  @IsString()
  name: string;

  @ApiProperty({ example: '12.345.678/0001-90' })
  @IsString()
  cnpj: string;

  @ApiProperty({ enum: CompanyType, example: CompanyType.MATRIZ })
  @IsEnum(CompanyType)
  type: CompanyType;

  @ApiPropertyOptional({ example: 'cuid-da-empresa-pai' })
  @IsOptional()
  @IsString()
  parentId?: string;
}
