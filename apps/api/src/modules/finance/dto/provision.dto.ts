import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class UpdateProvisionRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() daysFrom?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() daysTo?: number;
  @ApiPropertyOptional({ example: 30, description: '% de provisão da faixa' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class WriteOffDto {
  @ApiProperty({ description: 'Justificativa da baixa por perda (auditada)' })
  @IsString()
  @MinLength(10)
  reason: string;
}
