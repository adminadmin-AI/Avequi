import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ManifestActionDto {
  @ApiPropertyOptional({ description: 'Justificativa (obrigatória para rejeição e desconhecimento)', minLength: 15 })
  @IsOptional()
  @IsString()
  @MinLength(15, { message: 'Justificativa deve ter no mínimo 15 caracteres' })
  justificativa?: string;
}
