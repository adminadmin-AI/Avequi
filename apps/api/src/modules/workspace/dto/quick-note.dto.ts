import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Cores de papel do post-it — fechadas de propósito (o front tem o tint de cada). */
export const QUICK_NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple'] as const;
export type QuickNoteColor = (typeof QUICK_NOTE_COLORS)[number];

const MAX_TEXT = 500;

export class CreateQuickNoteDto {
  @ApiProperty({ maxLength: MAX_TEXT })
  @IsString()
  @MinLength(1)
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
  @MinLength(1)
  @MaxLength(MAX_TEXT)
  text?: string;

  @ApiPropertyOptional({ enum: QUICK_NOTE_COLORS })
  @IsOptional()
  @IsIn(QUICK_NOTE_COLORS)
  color?: QuickNoteColor;
}
