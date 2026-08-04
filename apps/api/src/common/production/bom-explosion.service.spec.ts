/**
 * #980 — Testes do serviço de explosão (a camada que fala com o banco).
 *
 * A aritmética já está coberta em `bom-explosion.spec.ts`. Aqui interessa o
 * encanamento: a consulta é determinística, o `companyId` é respeitado, a
 * ambiguidade da #981 chega ao chamador e **nada é escrito**.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BomExplosionService } from './bom-explosion.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  bomVersion: { findMany: jest.fn() },
};

const bomModelo = {
  id: 'bom-modelo',
  productId: 'modelo',
  version: 1,
  items: [
    { id: 'bi-1', componentId: 'peca', quantity: '4', scrapPct: '0', routingStepId: 'st-1', unit: 'UN' },
  ],
};

describe('BomExplosionService', () => {
  let service: BomExplosionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BomExplosionService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(BomExplosionService);
    jest.clearAllMocks();
  });

  describe('carregarBomsAtivas', () => {
    it('filtra por empresa e por BOM ativa', async () => {
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);

      await service.carregarBomsAtivas('co-1');

      expect(mockPrisma.bomVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'co-1', isActive: true } }),
      );
    });

    it('ordena de forma DETERMINÍSTICA — é a correção da #981 na borda da consulta', async () => {
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);

      await service.carregarBomsAtivas('co-1');

      const args = mockPrisma.bomVersion.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([
        { productId: 'asc' },
        { version: 'desc' },
        { id: 'asc' },
      ]);
    });

    it('traz o id do item de BOM e o routingStepId — sem eles a #817 não monta a OC', async () => {
      mockPrisma.bomVersion.findMany.mockResolvedValue([]);

      await service.carregarBomsAtivas('co-1');

      const args = mockPrisma.bomVersion.findMany.mock.calls[0][0];
      expect(args.select.items.select).toEqual(
        expect.objectContaining({ id: true, routingStepId: true, quantity: true, scrapPct: true }),
      );
    });
  });

  describe('explodir', () => {
    it('devolve ledger, raízes e o índice de BOMs ativas', async () => {
      mockPrisma.bomVersion.findMany.mockResolvedValue([bomModelo]);

      const r = await service.explodir('co-1', [{ productId: 'modelo', quantity: 10 }]);

      expect(r.roots).toHaveLength(1);
      expect(r.edges).toHaveLength(1);
      expect(r.edges[0].componentId).toBe('peca');
      expect(r.edges[0].quantity.toNumber()).toBe(40);
      expect(r.edges[0].routingStepId).toBe('st-1');
      expect(r.byProduct.has('modelo')).toBe(true);
      expect(r.inconsistencies).toEqual([]);
    });

    it('propaga a ambiguidade de BOM ativa para o chamador (#981)', async () => {
      mockPrisma.bomVersion.findMany.mockResolvedValue([
        bomModelo,
        { ...bomModelo, id: 'bom-modelo-v2', version: 2 },
      ]);

      const r = await service.explodir('co-1', [{ productId: 'modelo', quantity: 1 }]);

      expect(r.inconsistencies).toHaveLength(1);
      expect(r.inconsistencies[0].code).toBe('AMBIGUOUS_ACTIVE_BOM');
      // Escolhe a maior versão, mas não esconde o problema.
      expect(r.byProduct.get('modelo')!.id).toBe('bom-modelo-v2');
    });

    it('a ambiguidade da empresa vem ANTES das inconsistências do carrinho', async () => {
      mockPrisma.bomVersion.findMany.mockResolvedValue([
        bomModelo,
        { ...bomModelo, id: 'bom-modelo-v2', version: 2 },
      ]);

      const r = await service.explodir('co-1', [{ productId: 'modelo', quantity: 0 }]);

      expect(r.inconsistencies.map((i) => i.code)).toEqual([
        'AMBIGUOUS_ACTIVE_BOM',
        'INVALID_CART_QUANTITY',
      ]);
    });

    it('carrinho vazio devolve resultado vazio, sem erro', async () => {
      mockPrisma.bomVersion.findMany.mockResolvedValue([bomModelo]);

      const r = await service.explodir('co-1', []);

      expect(r.roots).toEqual([]);
      expect(r.edges).toEqual([]);
      expect(r.inconsistencies).toEqual([]);
    });

    it('NÃO escreve no banco em nenhum caminho', async () => {
      mockPrisma.bomVersion.findMany.mockResolvedValue([bomModelo]);

      await service.explodir('co-1', [{ productId: 'modelo', quantity: 5 }]);

      // O mock só expõe findMany. Qualquer tentativa de escrita (create,
      // update, upsert, delete, $transaction) estouraria por método inexistente
      // — este teste falha em vermelho se alguém adicionar escrita aqui.
      const chamadas = Object.keys(mockPrisma.bomVersion);
      expect(chamadas).toEqual(['findMany']);
      expect(mockPrisma.bomVersion.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
