import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Janela da agenda em dias — 7 (semana, default) até 42 (grid de mês). */
export class AgendaQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 42, default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(42)
  days?: number;
}
