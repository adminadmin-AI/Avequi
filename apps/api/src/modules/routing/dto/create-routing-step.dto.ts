import { IsString, IsOptional, IsInt, Min, IsPositive } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoutingStepDto {
  @ApiProperty() @IsString() productId: string;
  @ApiProperty() @IsInt() @IsPositive() stepOrder: number;
  @ApiProperty() @IsString() name: string;

  /**
   * #815 — referência OFICIAL do centro de trabalho.
   *
   * Contrato:
   *  - ausente        → no update, não altera o vínculo atual
   *  - id válido      → vira a fonte da verdade; `workCenter` é sobrescrito
   *                     com o `WorkCenter.code`
   *  - `null`         → limpeza explícita: zera FK **e** texto legado
   *
   * O tipo inclui `null` de propósito: `@IsOptional()` do class-validator já
   * aceita null, então o contrato real da API sempre permitiu enviá-lo. Tipar
   * como `string | null` documenta isso em vez de deixar implícito.
   */
  @ApiPropertyOptional({
    nullable: true,
    description: 'ID do centro de trabalho (referência oficial). null = remover o vínculo.',
  })
  @IsOptional()
  @IsString()
  workCenterId?: string | null;

  /**
   * #815 — LEGADO. Só é considerado quando `workCenterId` está AUSENTE do
   * payload. Enviar os dois com valores conflitantes não é ambíguo: a FK vence
   * e este campo é sobrescrito. Será removido em issue posterior.
   */
  @ApiPropertyOptional({
    nullable: true,
    deprecated: true,
    description: 'Código do centro (legado — use workCenterId). null = remover o vínculo.',
  })
  @IsOptional()
  @IsString()
  workCenter?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) setupTimeMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) runTimeMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
