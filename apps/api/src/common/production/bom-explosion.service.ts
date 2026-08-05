/**
 * #980 — Serviço de explosão de BOM: a camada que fala com o banco.
 *
 * A aritmética da explosão mora no núcleo puro (`bom-explosion.ts`), que não
 * conhece Prisma. Este serviço só faz duas coisas:
 *
 *   1. Carregar as BOMs ativas da empresa, com ordenação DETERMINÍSTICA.
 *   2. Chamar o núcleo e devolver o ledger.
 *
 * **Somente leitura.** Nenhum caminho deste arquivo escreve no banco.
 *
 * Consumidores:
 *   - `MrpService` — usa a projeção plana (`agregarPorProduto`).
 *   - `DispatchService` (#817) — usa o ledger de arestas, para chegar no
 *     `routingStepId` de cada componente e montar OS/OC por setor.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BomVersionInput,
  CartLine,
  ExplosionResult,
  Inconsistency,
  explodirCarrinho,
  selecionarBomsAtivas,
} from './bom-explosion';

export interface ExplosaoDaEmpresa extends ExplosionResult {
  /**
   * BOMs ativas indexadas por produto, já com a ambiguidade resolvida.
   * O MRP usa isto para decidir entre sugestão de COMPRA e de PRODUÇÃO:
   * quem tem BOM, fabrica; quem não tem, compra.
   */
  byProduct: Map<string, BomVersionInput>;
}

@Injectable()
export class BomExplosionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Carrega as BOMs ativas da empresa.
   *
   * O `orderBy` NÃO é decoração: sem ele, dois registros ativos do mesmo
   * produto entram no índice em ordem imprevisível e um sobrescreve o outro em
   * silêncio — o bug da #981. A ordenação aqui só torna a entrada estável; quem
   * escolhe e denuncia a duplicidade é `selecionarBomsAtivas`.
   */
  async carregarBomsAtivas(companyId: string): Promise<BomVersionInput[]> {
    const versions = await this.prisma.bomVersion.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ productId: 'asc' }, { version: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        productId: true,
        version: true,
        items: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            componentId: true,
            quantity: true,
            scrapPct: true,
            routingStepId: true,
            unit: true,
          },
        },
      },
    });

    return versions as BomVersionInput[];
  }

  /**
   * Explode um carrinho `{ productId, quantity }[]` para a empresa informada.
   *
   * `companyId` vem SEMPRE do JWT na borda — nunca do corpo da requisição.
   */
  async explodir(companyId: string, cart: readonly CartLine[]): Promise<ExplosaoDaEmpresa> {
    const versions = await this.carregarBomsAtivas(companyId);
    const { byProduct, inconsistencies: ambiguidades } = selecionarBomsAtivas(versions);

    const resultado = explodirCarrinho(cart, byProduct);

    // A ambiguidade de BOM ativa é da empresa, não de um carrinho específico —
    // por isso vem primeiro na lista.
    const inconsistencies: Inconsistency[] = [...ambiguidades, ...resultado.inconsistencies];

    return { ...resultado, inconsistencies, byProduct };
  }
}
