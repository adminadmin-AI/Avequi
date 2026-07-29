import { Type } from 'class-transformer';
import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, Min, IsPositive } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BomItemDto {
  @ApiProperty() @IsString() componentId: string;
  @ApiProperty() @IsNumber() @IsPositive() quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) scrapPct?: number;

  /**
   * #815 — operação do roteiro onde este componente é consumido.
   * Opcional: item sem operação alocada continua válido. Quando informado,
   * o passo tem de ser da MESMA empresa e do MESMO produto da BOM.
   */
  @ApiPropertyOptional({
    description: 'ID da operação do roteiro onde o componente é consumido (mesmo produto da BOM)',
  })
  @IsOptional()
  @IsString()
  routingStepId?: string;
}

export class CreateBomDto {
  @ApiProperty() @IsString() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [BomItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomItemDto)
  items: BomItemDto[];
}
