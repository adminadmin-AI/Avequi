import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Cores de papel do post-it — fechadas de propósito (o front tem o tint de cada). */
export const QUICK_NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple'] as const;
export type QuickNoteColor = (typeof QUICK_NOTE_COLORS)[number];

const MAX_TEXT = 500;

export class CreateQuickNoteDto {
  // Post-it NASCE vazio: o widget cria em branco e o usuário digita no papel
  // (autosave no blur). Vazio abandonado é removido pelo front — não persiste.
  @ApiProperty({ maxLength: MAX_TEXT, description: 'Pode nascer vazio (edição inline)' })
  @IsString()
  @MaxLength(MAX_TEXT)
  text!: string;

  @ApiPropertyOptional({ enum: QUICK_NOTE_COLORS, default: 'yellow' })
  @IsOptional()
  @IsIn(QUICK_NOTE_COLORS)
  color?: QuickNoteColor;
}

/** Update parcial — texto, cor, fixar e arquivar; todos opcionais (PATCH). */
export class UpdateQuickNoteDto {
  @ApiPropertyOptional({ maxLength: MAX_TEXT })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  text?: string;

  @ApiPropertyOptional({ enum: QUICK_NOTE_COLORS })
  @IsOptional()
  @IsIn(QUICK_NOTE_COLORS)
  color?: QuickNoteColor;

  @ApiPropertyOptional({ description: 'Fixa (true) ou solta (false) a nota no topo do mural' })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @ApiPropertyOptional({ description: 'Arquiva (true) ou devolve ao mural (false) — o "desfazer"' })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

/**
 * Nova ordem do mural: ids na sequência desejada. Ids que não sejam do
 * usuário são simplesmente ignorados (o where sempre carrega o userId), então
 * o pior caso de um payload forjado é não fazer nada.
 */
export class ReorderQuickNotesDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  ids!: string[];
}
