import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ImportOfxDto {
  @ApiProperty({ description: 'Conta bancária de destino do extrato' })
  @IsString()
  @IsNotEmpty()
  bankAccountId: string;

  @ApiProperty({ description: 'Conteúdo do arquivo OFX/QFX (texto)' })
  @IsString()
  @IsNotEmpty()
  ofxContent: string;
}

export class MatchStatementDto {
  @ApiProperty({ description: 'FinancialEntry a vincular ao item do extrato' })
  @IsString()
  @IsNotEmpty()
  entryId: string;
}

export class CreateEntryFromStatementDto {
  @ApiPropertyOptional({ description: 'Descrição do lançamento (default: memo do extrato)' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Categoria financeira (ex.: tarifas bancárias)' })
  @IsOptional()
  @IsString()
  categoryId?: string;
}
