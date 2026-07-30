import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Layout do Workspace (F2) — desvios do template, validação ESTRUTURAL.
 * A validação semântica (id existe? widget elegível?) é do frontend no merge:
 * ids desconhecidos são ignorados na leitura, então um id órfão persistido é
 * inofensivo por design (forward-compat com widgets removidos/renomeados).
 */
export class LayoutWidgetDto {
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-z][a-z0-9-]*$/)
  id!: string;

  @IsOptional()
  @IsIn(['half', 'full'])
  size?: 'half' | 'full';

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class SaveLayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-z][a-z0-9-]*$/)
  profile?: string;

  @IsInt()
  @Min(1)
  version!: number;

  @IsArray()
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => LayoutWidgetDto)
  widgets!: LayoutWidgetDto[];
}
