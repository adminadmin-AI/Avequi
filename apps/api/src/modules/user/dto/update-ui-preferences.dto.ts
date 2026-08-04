import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/**
 * Preferências de UI da sidebar (#975) — validação ESTRUTURAL apenas.
 * A validação semântica (href existe? seção existe?) fica no frontend, que
 * ignora entradas desconhecidas na leitura — mesmo design forward-compat do
 * SaveLayoutDto (item de menu removido/renomeado persiste inofensivo).
 */
export class UpdateUiPreferencesDto {
  /** hrefs favoritados, na ordem de exibição (ex.: '/sales') */
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  favorites!: string[];

  /** keys das seções da sidebar recolhidas pelo usuário */
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  collapsedSections!: string[];
}
