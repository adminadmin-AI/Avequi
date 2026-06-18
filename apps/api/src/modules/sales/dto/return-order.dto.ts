import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ReturnOrderDto {
  @ApiProperty({ example: 'Produto com defeito', description: 'Motivo da devolução (obrigatório)' })
  @IsString()
  @MinLength(3)
  reason: string;
}
