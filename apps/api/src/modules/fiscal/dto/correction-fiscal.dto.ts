import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CorrectionFiscalDto {
  @ApiProperty({
    example: 'Correção do endereço de entrega: Rua Nova, 200',
    description: 'Texto da correção (mínimo 15 caracteres — exigência SEFAZ)',
    minLength: 15,
  })
  @IsString()
  @MinLength(15, { message: 'Texto de correção deve ter no mínimo 15 caracteres (exigência SEFAZ)' })
  correcao: string;
}
