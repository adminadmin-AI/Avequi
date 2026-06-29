import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ConfigureBankAccountDto {
  @ApiPropertyOptional({ example: 'INTER', description: 'Provider: INTER, SICOOB, MANUAL, etc.' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ example: 'email@empresa.com', description: 'Chave PIX' })
  @IsOptional()
  @IsString()
  pixKey?: string;

  @ApiPropertyOptional({ example: 5000, description: 'Saldo mínimo de caixa' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minCashBalance?: number;
}
