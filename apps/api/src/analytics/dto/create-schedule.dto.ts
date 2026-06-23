import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsEmail } from 'class-validator';

export class CreateScheduleDto {
  @ApiProperty({ example: 'Relatório Semanal de Vendas' })
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dashboardId?: string;

  @ApiProperty({ example: 'PDF', enum: ['PDF', 'CSV', 'XLSX'] })
  @IsString()
  format!: string;

  @ApiProperty({ example: '0 8 * * 1' })
  @IsString()
  cronExpr!: string;

  @ApiProperty({ example: ['gerente@empresa.com'] })
  @IsArray()
  @IsEmail({}, { each: true })
  recipients!: string[];
}
