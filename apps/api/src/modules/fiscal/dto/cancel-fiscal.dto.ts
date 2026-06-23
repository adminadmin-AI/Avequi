import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CancelFiscalDto {
  @ApiProperty({
    example: 'Erro no valor do produto — cliente solicitou cancelamento',
    description: 'Justificativa do cancelamento (mínimo 15 caracteres — exigência SEFAZ)',
    minLength: 15,
  })
  @IsString()
  @MinLength(15, { message: 'Justificativa deve ter no mínimo 15 caracteres (exigência SEFAZ)' })
  justificativa: string;
}
