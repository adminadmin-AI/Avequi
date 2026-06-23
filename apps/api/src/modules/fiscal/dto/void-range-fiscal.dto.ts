import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class VoidRangeFiscalDto {
  @ApiProperty({ example: '1', description: 'Série da NF-e' })
  @IsString()
  serie: string;

  @ApiProperty({ example: 101, description: 'Número inicial da faixa' })
  @IsInt()
  @Min(1)
  numberStart: number;

  @ApiProperty({ example: 104, description: 'Número final da faixa' })
  @IsInt()
  @Min(1)
  numberEnd: number;

  @ApiProperty({ example: 'Erro de numeração no sistema — gap entre notas 100 e 105', minLength: 15 })
  @IsString()
  @MinLength(15, { message: 'Justificativa deve ter no mínimo 15 caracteres (exigência SEFAZ)' })
  justificativa: string;
}
