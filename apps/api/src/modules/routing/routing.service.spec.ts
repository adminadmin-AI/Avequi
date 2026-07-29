import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RoutingService } from './routing.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * #815 — fundação do roteiro por item.
 *
 * Cobre a resolução do centro de trabalho pela FK, a sincronização com o campo
 * textual legado, o isolamento entre empresas e o bloqueio de exclusão de etapa
 * que tenha componente de BOM alocado.
 */
describe('RoutingService (#815)', () => {
  let service: RoutingService;

  const mockPrisma = {
    routingStep: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    workCenter: { findFirst: jest.fn() },
    product: { findFirst: jest.fn() },
    bomItem: { count: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  const USER = { id: 'user-1', companyId: 'empresa-A' };
  const WC_SOLDA = { id: 'wc-solda', code: 'SET-SOL-002' };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod: TestingModule = await Test.createTestingModule({
      providers: [RoutingService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = mod.get<RoutingService>(RoutingService);

    // Caminho feliz padrão
    mockPrisma.routingStep.findUnique.mockResolvedValue(null);
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod-1', companyId: 'empresa-A' });
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.routingStep.create.mockImplementation(({ data }: any) => ({ id: 'step-1', ...data }));
    mockPrisma.routingStep.update.mockImplementation(({ data }: any) => ({ id: 'step-1', ...data }));
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    const base = { productId: 'prod-1', stepOrder: 1, name: 'Solda' };

    it('aceita workCenterId válido e grava a FK', async () => {
      mockPrisma.workCenter.findFirst.mockResolvedValue(WC_SOLDA);

      await service.create({ ...base, workCenterId: 'wc-solda' } as any, USER);

      expect(mockPrisma.workCenter.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'wc-solda', companyId: 'empresa-A' } }),
      );
      const data = mockPrisma.routingStep.create.mock.calls[0][0].data;
      expect(data.workCenterId).toBe('wc-solda');
    });

    it('sincroniza o texto legado com WorkCenter.code', async () => {
      mockPrisma.workCenter.findFirst.mockResolvedValue(WC_SOLDA);

      await service.create({ ...base, workCenterId: 'wc-solda' } as any, USER);

      const data = mockPrisma.routingStep.create.mock.calls[0][0].data;
      expect(data.workCenter).toBe('SET-SOL-002');
      expect(data.workCenterId).toBe('wc-solda');
    });

    it('texto enviado pelo cliente é sobrescrito pelo code do centro', async () => {
      mockPrisma.workCenter.findFirst.mockResolvedValue(WC_SOLDA);

      await service.create(
        { ...base, workCenterId: 'wc-solda', workCenter: 'TEXTO-ERRADO' } as any,
        USER,
      );

      const data = mockPrisma.routingStep.create.mock.calls[0][0].data;
      expect(data.workCenter).toBe('SET-SOL-002');
    });

    it('rejeita centro de trabalho de outra empresa', async () => {
      // findFirst é escopado por companyId — centro de outra empresa não retorna
      mockPrisma.workCenter.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ ...base, workCenterId: 'wc-de-outra-empresa' } as any, USER),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrisma.routingStep.create).not.toHaveBeenCalled();
    });

    it('caminho legado: texto que casa com um centro já preenche a FK', async () => {
      mockPrisma.workCenter.findFirst.mockResolvedValue(WC_SOLDA);

      await service.create({ ...base, workCenter: 'SET-SOL-002' } as any, USER);

      const data = mockPrisma.routingStep.create.mock.calls[0][0].data;
      expect(data.workCenterId).toBe('wc-solda');
      expect(data.workCenter).toBe('SET-SOL-002');
    });

    it('caminho legado: texto sem centro correspondente é preservado, sem FK', async () => {
      mockPrisma.workCenter.findFirst.mockResolvedValue(null);

      await service.create({ ...base, workCenter: 'AINDA-NAO-CADASTRADO' } as any, USER);

      const data = mockPrisma.routingStep.create.mock.calls[0][0].data;
      expect(data.workCenterId).toBeNull();
      expect(data.workCenter).toBe('AINDA-NAO-CADASTRADO');
    });

    it('etapa sem centro nenhum continua válida', async () => {
      await service.create({ ...base } as any, USER);

      const data = mockPrisma.routingStep.create.mock.calls[0][0].data;
      expect(data.workCenterId).toBeNull();
      expect(data.workCenter).toBeNull();
      expect(mockPrisma.workCenter.findFirst).not.toHaveBeenCalled();
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    const EXISTENTE = {
      id: 'step-1',
      companyId: 'empresa-A',
      productId: 'prod-1',
      stepOrder: 1,
      name: 'Solda',
      workCenterId: null,
      workCenter: 'ANTIGO',
    };

    beforeEach(() => {
      mockPrisma.routingStep.findFirst.mockResolvedValue(EXISTENTE);
    });

    it('sincroniza texto e FK ao trocar o centro', async () => {
      mockPrisma.workCenter.findFirst.mockResolvedValue(WC_SOLDA);

      await service.update('step-1', { workCenterId: 'wc-solda' } as any, USER);

      const data = mockPrisma.routingStep.update.mock.calls[0][0].data;
      expect(data.workCenterId).toBe('wc-solda');
      expect(data.workCenter).toBe('SET-SOL-002');
    });

    it('rejeita centro de outra empresa no update', async () => {
      mockPrisma.workCenter.findFirst.mockResolvedValue(null);

      await expect(
        service.update('step-1', { workCenterId: 'wc-de-outra-empresa' } as any, USER),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrisma.routingStep.update).not.toHaveBeenCalled();
    });

    it('update que não menciona centro NÃO mexe nos dois campos', async () => {
      await service.update('step-1', { name: 'Solda MIG' } as any, USER);

      const data = mockPrisma.routingStep.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('workCenterId');
      expect(data).not.toHaveProperty('workCenter');
      expect(mockPrisma.workCenter.findFirst).not.toHaveBeenCalled();
    });

    it('etapa de outra empresa não é encontrada', async () => {
      mockPrisma.routingStep.findFirst.mockResolvedValue(null);

      await expect(
        service.update('step-de-outra', { name: 'x' } as any, USER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // ─── contrato dos 4 casos de limpeza/conflito ─────────────────────────
    describe('contrato do vínculo com o centro (4 casos)', () => {
      const COM_VINCULO = {
        ...EXISTENTE,
        workCenterId: 'wc-solda',
        workCenter: 'SET-SOL-002',
      };

      it('1) workCenterId válido: vira fonte da verdade e sobrescreve o texto', async () => {
        mockPrisma.routingStep.findFirst.mockResolvedValue(COM_VINCULO);
        mockPrisma.workCenter.findFirst.mockResolvedValue({ id: 'wc-corte', code: 'SET-MET-001' });

        await service.update('step-1', { workCenterId: 'wc-corte' } as any, USER);

        const data = mockPrisma.routingStep.update.mock.calls[0][0].data;
        expect(data.workCenterId).toBe('wc-corte');
        expect(data.workCenter).toBe('SET-MET-001');
      });

      it('1b) FK vence texto conflitante enviado no mesmo payload', async () => {
        mockPrisma.routingStep.findFirst.mockResolvedValue(COM_VINCULO);
        mockPrisma.workCenter.findFirst.mockResolvedValue({ id: 'wc-corte', code: 'SET-MET-001' });

        await service.update(
          'step-1',
          { workCenterId: 'wc-corte', workCenter: 'TEXTO-CONFLITANTE' } as any,
          USER,
        );

        const data = mockPrisma.routingStep.update.mock.calls[0][0].data;
        expect(data.workCenterId).toBe('wc-corte');
        expect(data.workCenter).toBe('SET-MET-001');
        // nunca divergentes
        expect(data.workCenter).not.toBe('TEXTO-CONFLITANTE');
      });

      it('2) workCenterId: null limpa a FK E o texto legado', async () => {
        mockPrisma.routingStep.findFirst.mockResolvedValue(COM_VINCULO);

        await service.update('step-1', { workCenterId: null } as any, USER);

        const data = mockPrisma.routingStep.update.mock.calls[0][0].data;
        expect(data.workCenterId).toBeNull();
        expect(data.workCenter).toBeNull();
        // não pode reresolver pelo texto que já estava gravado
        expect(mockPrisma.workCenter.findFirst).not.toHaveBeenCalled();
      });

      it('2b) workCenterId: null limpa mesmo com texto preenchido no payload', async () => {
        mockPrisma.routingStep.findFirst.mockResolvedValue(COM_VINCULO);

        await service.update(
          'step-1',
          { workCenterId: null, workCenter: 'SET-SOL-002' } as any,
          USER,
        );

        const data = mockPrisma.routingStep.update.mock.calls[0][0].data;
        expect(data.workCenterId).toBeNull();
        expect(data.workCenter).toBeNull();
      });

      it('3) só texto (FK ausente): caminho legado resolve e preenche a FK', async () => {
        mockPrisma.routingStep.findFirst.mockResolvedValue(EXISTENTE);
        mockPrisma.workCenter.findFirst.mockResolvedValue(WC_SOLDA);

        await service.update('step-1', { workCenter: 'SET-SOL-002' } as any, USER);

        const data = mockPrisma.routingStep.update.mock.calls[0][0].data;
        expect(data.workCenterId).toBe('wc-solda');
        expect(data.workCenter).toBe('SET-SOL-002');
      });

      it('4) workCenter: null (FK ausente) também limpa os dois', async () => {
        mockPrisma.routingStep.findFirst.mockResolvedValue(COM_VINCULO);

        await service.update('step-1', { workCenter: null } as any, USER);

        const data = mockPrisma.routingStep.update.mock.calls[0][0].data;
        expect(data.workCenterId).toBeNull();
        expect(data.workCenter).toBeNull();
      });

      it('5) ambos ausentes: vínculo atual é preservado intacto', async () => {
        mockPrisma.routingStep.findFirst.mockResolvedValue(COM_VINCULO);

        await service.update('step-1', { setupTimeMin: 15 } as any, USER);

        const data = mockPrisma.routingStep.update.mock.calls[0][0].data;
        expect(data).not.toHaveProperty('workCenterId');
        expect(data).not.toHaveProperty('workCenter');
        expect(mockPrisma.workCenter.findFirst).not.toHaveBeenCalled();
      });
    });
  });

  // ─── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    beforeEach(() => {
      mockPrisma.routingStep.findFirst.mockResolvedValue({
        id: 'step-1',
        companyId: 'empresa-A',
        name: 'Solda',
        productId: 'prod-1',
        stepOrder: 1,
      });
    });

    it('bloqueia exclusão de etapa com componente de BOM alocado', async () => {
      mockPrisma.bomItem.count.mockResolvedValue(3);

      await expect(service.remove('step-1', 'empresa-A')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.routingStep.delete).not.toHaveBeenCalled();
    });

    it('mensagem de bloqueio informa quantos itens estão alocados', async () => {
      mockPrisma.bomItem.count.mockResolvedValue(3);

      await expect(service.remove('step-1', 'empresa-A')).rejects.toThrow(/3 item/);
    });

    it('permite exclusão quando não há alocação', async () => {
      mockPrisma.bomItem.count.mockResolvedValue(0);
      mockPrisma.routingStep.delete.mockResolvedValue({});

      await expect(service.remove('step-1', 'empresa-A')).resolves.toEqual({ deleted: true });
      expect(mockPrisma.routingStep.delete).toHaveBeenCalledWith({ where: { id: 'step-1' } });
    });
  });
});
