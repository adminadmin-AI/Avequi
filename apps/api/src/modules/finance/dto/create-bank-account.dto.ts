import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBankAccountDto {
  @ApiProperty({ example: 'Bradesco Corrente' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({ example: 'Bradesco' })
  @IsOptional()
  @IsString()
  bank?: string;

  @ApiPropertyOptional({ example: '1234-5' })
  @IsOptional()
  @IsString()
  agency?: string;

  @ApiPropertyOptional({ example: '00001-2' })
  @IsOptional()
  @IsString()
  account?: string;
}
