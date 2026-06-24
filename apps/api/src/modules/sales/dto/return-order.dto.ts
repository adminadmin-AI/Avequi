import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ReturnOrderDto {
  @ApiProperty({ example: 'Produto com defeito', description: 'Motivo da devolução (obrigatório)' })
  @IsString()
  @MinLength(3)
  reason: string;

  @ApiPropertyOptional({
    example: 'Devolução de venda — produto com defeito de fabricação',
    description: 'Justificativa para cancelamento da NF-e na SEFAZ (mín. 15 caracteres)',
  })
  @IsOptional()
  @IsString()
  @MinLength(15)
  justificativa?: string;
}
