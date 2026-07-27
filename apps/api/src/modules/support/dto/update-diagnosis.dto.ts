import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Um ponteiro repo-aware que o runner apontou como suspeito. */
export class TriageFileDto {
  @IsString()
  @MaxLength(400)
  path: string;

  @IsInt()
  @Min(0)
  line: number;

  @IsString()
  @MaxLength(500)
  reason: string;
}

/**
 * Write-back assinado do runner (#768). Corpo do
 * `PATCH /support/incidents/:id/diagnosis`. Validado com class-validator +
 * ValidationPipe global (whitelist/forbidNonWhitelisted) — payload fora do
 * schema (severity/confidence inválidos, campo extra) é rejeitado com 400.
 *
 * Campos nuláveis (`isDuplicateOf`, `suggestedFix`, `safeSelfServiceStep`) usam
 * @IsOptional para aceitar `null` explícito que o runner sempre envia.
 */
export class UpdateDiagnosisDto {
  @IsString()
  @MaxLength(2000)
  probableCause: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TriageFileDto)
  files: TriageFileDto[];

  @IsString()
  @MaxLength(120)
  module: string;

  @IsIn(['P0', 'P1', 'P2', 'P3'])
  severity: 'P0' | 'P1' | 'P2' | 'P3';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  isDuplicateOf: string | null;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  suggestedFix: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  safeSelfServiceStep: string | null;

  @IsBoolean()
  needsHuman: boolean;
}
