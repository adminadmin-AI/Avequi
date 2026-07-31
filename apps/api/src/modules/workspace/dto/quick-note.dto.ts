import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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

/** Update parcial — texto e/ou cor; ambos opcionais (PATCH). */
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
}
