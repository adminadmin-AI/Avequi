import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsPositive, IsString, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * #817 — Uma linha do carrinho de despacho: "quero N unidades deste produto".
 *
 * `companyId` NÃO existe aqui de propósito: ele vem sempre do JWT, nunca do
 * corpo da requisição.
 */
export class DispatchCartItemDto {
  @ApiProperty({ description: 'ID do produto a ser fabricado' })
  @IsString()
  productId: string;

  /**
   * Quantidade positiva. Zero e negativo são recusados aqui, na borda HTTP,
   * porque são erro de requisição — não resultado de cálculo. O núcleo de
   * explosão também sabe recusar (`INVALID_CART_QUANTITY`), o que protege
   * chamadores internos; esta validação é a primeira barreira, não a única.
   */
  @ApiProperty({ description: 'Quantidade a produzir (maior que zero)', example: 50 })
  @IsNumber()
  @IsPositive()
  quantity: number;
}

export class DispatchRequestDto {
  /**
   * Carrinho de modelos. **Vazio é válido** e devolve um despacho vazio, sem
   * erro — é o comportamento esperado de uma simulação sem itens.
   */
  @ApiProperty({
    type: [DispatchCartItemDto],
    description: 'Carrinho de modelos a despachar. Lista vazia é válida e devolve despacho vazio.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DispatchCartItemDto)
  items: DispatchCartItemDto[];
}
