import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateDiscountPolicyDto {
  // 99.99 + 2 casas: a coluna é Decimal(5,2) e 100% não é alçada (#947).
  // @Max(100) deixava 99.995 passar na validação e virar 100.00 na gravação,
  // furando o guarda do service pela banda do arredondamento.
  @ApiPropertyOptional({ example: 15, description: 'Teto de desconto (%), máximo 99.99' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99.99)
  maxDiscountPct?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
