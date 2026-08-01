import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ChassiService } from './chassi.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  gdrChassiGravacao: { findMany: jest.fn(), findUnique: jest.fn() },
  gdrChassiSerie: { findMany: jest.fn() },
  gdrChassiNumero: { groupBy: jest.fn() },
};

const GRAVACAO = {
  id: BigInt(7),
  vin: '92UPRTA75TS005696',
  tipo: 'padrao',
  observacao: null,
  numero: 5696,
  ano: 2026,
  operador: 'Fulano',
  status: 'concluida',
  criadoEm: new Date('2026-07-31T10:00:00Z'),
  concluidoEm: new Date('2026-07-31T10:03:00Z'),
  quadro: { codigo: 'CON-CHA-001', nome: 'Chassi 1,50m x 1,10m V80' },
  serie: { codigo: 'CARRETINHA_A', nome: 'Carretinha A' },
};

describe('ChassiService', () => {
  let service: ChassiService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChassiService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<ChassiService>(ChassiService);
  });

  describe('listarGravacoes', () => {
    it('lista sem filtros e serializa BigInt como number', async () => {
      mockPrisma.gdrChassiGravacao.findMany.mockResolvedValue([GRAVACAO]);
      const result = await service.listarGravacoes({});
      expect(mockPrisma.gdrChassiGravacao.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, take: 500 }),
      );
      expect(result[0].id).toBe(7);
      expect(typeof result[0].id).toBe('number');
      expect(result[0].vin).toBe('92UPRTA75TS005696');
      expect(result[0].quadro).toEqual({ codigo: 'CON-CHA-001', nome: 'Chassi 1,50m x 1,10m V80' });
    });

    it('aplica filtros: vin em maiúsculas, tipo, status e quadroCodigo', async () => {
      mockPrisma.gdrChassiGravacao.findMany.mockResolvedValue([]);
      await service.listarGravacoes({
        vin: '5696', tipo: 'especial', status: 'concluida', quadroCodigo: 'CON-CHA-001',
      });
      expect(mockPrisma.gdrChassiGravacao.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            vin: { contains: '5696' },
            tipo: 'especial',
            status: 'concluida',
            quadro: { codigo: 'CON-CHA-001' },
          },
        }),
      );
    });

    it('ignora tipo desconhecido (não vira filtro)', async () => {
      mockPrisma.gdrChassiGravacao.findMany.mockResolvedValue([]);
      await service.listarGravacoes({ tipo: 'zumbi' });
      const arg = mockPrisma.gdrChassiGravacao.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({});
    });

    it('gravação do Modelo Especial vem sem quadro e com observacao', async () => {
      mockPrisma.gdrChassiGravacao.findMany.mockResolvedValue([
        { ...GRAVACAO, tipo: 'especial', quadro: null, observacao: 'Carreta fora de linha' },
      ]);
      const [g] = await service.listarGravacoes({});
      expect(g.quadro).toBeNull();
      expect(g.observacao).toBe('Carreta fora de linha');
    });
  });

  describe('detalheGravacao', () => {
    it('retorna detalhe com a trilha de eventos serializada', async () => {
      mockPrisma.gdrChassiGravacao.findUnique.mockResolvedValue({
        ...GRAVACAO,
        serie: { ...GRAVACAO.serie, prefixo: '92UPRTA75TS00' },
        eventos: [
          { id: BigInt(1), evento: 'iniciada', etapa: null, operador: 'Fulano', detalhe: null, criadoEm: new Date() },
          { id: BigInt(2), evento: 'etapa_gravada', etapa: 'plaqueta', operador: 'Fulano', detalhe: { modo: 'real' }, criadoEm: new Date() },
        ],
      });
      const result = await service.detalheGravacao(7);
      expect(mockPrisma.gdrChassiGravacao.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: BigInt(7) } }),
      );
      expect(result.eventos).toHaveLength(2);
      expect(result.eventos[1]).toEqual(
        expect.objectContaining({ id: 2, evento: 'etapa_gravada', etapa: 'plaqueta' }),
      );
    });

    it('id inexistente lança NotFoundException', async () => {
      mockPrisma.gdrChassiGravacao.findUnique.mockResolvedValue(null);
      await expect(service.detalheGravacao(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('painelSeries', () => {
    it('calcula usados/reservados/restantes por série e o alerta', async () => {
      mockPrisma.gdrChassiSerie.findMany.mockResolvedValue([
        { id: BigInt(1), codigo: 'CARRETINHA_A', nome: 'Carretinha A', prefixo: '92UPRTA75TS00', eixos: '1 eixo', ano: 2026, faixaMin: 5000, faixaMax: 9999, ativo: true },
        { id: BigInt(4), codigo: 'PLATAFORMA', nome: 'Plataforma GDR', prefixo: '979VPRPLTTS0H', eixos: '1 eixo', ano: 2026, faixaMin: 3500, faixaMax: 3999, ativo: true },
      ]);
      mockPrisma.gdrChassiNumero.groupBy.mockResolvedValue([
        { serieId: BigInt(1), status: 'usado', _count: { _all: 3 } },
        { serieId: BigInt(1), status: 'reservado', _count: { _all: 10 } },
        { serieId: BigInt(4), status: 'usado', _count: { _all: 450 } },
      ]);

      const [a, plt] = await service.painelSeries();
      expect(a).toEqual(expect.objectContaining({
        codigo: 'CARRETINHA_A', usados: 3, reservados: 10, restantes: 5000 - 13, alerta: false,
      }));
      // Plataforma: faixa 500 − 450 usados = 50 restantes → alerta ligado
      expect(plt).toEqual(expect.objectContaining({ usados: 450, restantes: 50, alerta: true }));
    });

    it('série sem números no pool vem zerada com a faixa cheia', async () => {
      mockPrisma.gdrChassiSerie.findMany.mockResolvedValue([
        { id: BigInt(2), codigo: 'CARRETINHA_B', nome: 'Carretinha B', prefixo: '92UPRTB75TS00', eixos: '1 eixo', ano: 2026, faixaMin: 5000, faixaMax: 9999, ativo: true },
      ]);
      mockPrisma.gdrChassiNumero.groupBy.mockResolvedValue([]);
      const [b] = await service.painelSeries();
      expect(b).toEqual(expect.objectContaining({ usados: 0, reservados: 0, restantes: 5000, alerta: false }));
    });
  });
});
