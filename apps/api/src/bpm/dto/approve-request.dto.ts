import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class ApproveRequestDto {
  @ApiPropertyOptional({ example: 'Aprovado conforme política de compras' })
  @IsString()
  @IsOptional()
  comments?: string;
}
