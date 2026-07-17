import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReturnNoteFiscalDto {
  @ApiPropertyOptional({
    example: 'Produto com defeito de fabricação',
    description: 'Motivo da devolução — vai nas informações complementares da NF-e',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;
}
