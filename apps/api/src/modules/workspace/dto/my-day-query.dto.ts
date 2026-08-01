import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Janela de comparação do Meu Dia, em dias (default 30): os últimos N dias
 * contra os N imediatamente anteriores. Espelha o seletor de período do
 * Workspace (7 / 30 / 90).
 */
export class MyDayQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 90, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}
