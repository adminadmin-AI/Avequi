import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateDiscountPolicyDto {
  @ApiPropertyOptional({ example: 15, description: 'Teto de desconto (%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxDiscountPct?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
