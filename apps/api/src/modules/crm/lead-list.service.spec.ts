import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmService } from './crm.service';
import { LeadIntakeService } from './lead-intake.service';
import { LeadListService } from './lead-list.service';

const COMPANY = 'company-1';

describe('LeadListService (F3.5-C7 #557)', () => {
  let service: LeadListService;
  let prisma: any;
  let crm: { changeStage: jest.Mock };
  let intake: { reassign: jest.Mock };

  beforeEach(async () => {
    prisma = {
      lead: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    crm = { changeStage: jest.fn().mockResolvedValue({}) };
    intake = { reassign: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadListService,
        { provide: PrismaService, useValue: prisma },
        { provide: CrmService, useValue: crm },
        { provide: LeadIntakeService, useValue: intake },
      ],
    }).compile();
    service = module.get(LeadListService);
  });

  describe('list', () => {
    it('combina filtros: origem + estágio + vendedor + período + busca', async () => {
      await service.list(COMPANY, {
        source: 'META_ADS',
        stageId: 'stage-proposta',
        assignedToId: 'seller-1',
        from: '2026-07-01',
        to: '2026-07-06',
        search: 'joão',
      });
      const where = prisma.lead.findMany.mock.calls[0][0].where;
      expect(where.companyId).toBe(COMPANY);
      expect(where.source).toBe('META_ADS');
      expect(where.stageId).toBe('stage-proposta');
      expect(where.assignedToId).toBe('seller-1');
      expect(where.createdAt.gte).toEqual(new Date('2026-07-01'));
      // "até" inclui o dia inteiro (23:59:59)
      expect(where.createdAt.lte.getHours()).toBe(23);
      expect(where.OR).toHaveLength(4); // nome, telefone, email, interesse
    });

    it('pagina com teto de 100 e devolve total', async () => {
      prisma.lead.count.mockResolvedValue(250);
      const res = await service.list(COMPANY, { page: 2, pageSize: 999 });
      const args = prisma.lead.findMany.mock.calls[0][0];
      expect(args.take).toBe(100);
      expect(args.skip).toBe(100); // página 2
      expect(res.total).toBe(250);
    });

    it('sortBy fora da whitelist cai pro default createdAt desc', async () => {
      await service.list(COMPANY, { sortBy: 'phone' as any, sortDir: 'up' as any });
      expect(prisma.lead.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
    });

    it('busca por telefone remove máscara', async () => {
      await service.list(COMPANY, { search: '(45) 99999-8888' });
      const where = prisma.lead.findMany.mock.calls[0][0].where;
      expect(where.OR[1]).toEqual({ phone: { contains: '45999998888' } });
    });
  });

  describe('csv', () => {
    it('gera CSV com header e escapa ; e aspas', async () => {
      prisma.lead.findMany.mockResolvedValue([
        {
          name: 'João; "o grande"',
          phone: '5545999998888',
          email: null,
          source: 'META_ADS',
          interest: 'reboque 2 jet skis',
          estimatedValue: null,
          lostReason: null,
          createdAt: new Date('2026-07-06T12:00:00Z'),
          lastInteractionAt: null,
          stage: { name: 'Proposta' },
          assignedTo: { name: 'Vendedor 1' },
        },
      ]);
      const csv = await service.csv(COMPANY, { source: 'META_ADS' });
      const [header, row] = csv.split('\n');
      expect(header).toContain('nome;telefone');
      expect(row).toContain('"João; ""o grande"""');
      expect(row).toContain('Proposta');
      // mesmo builder de filtros da lista
      expect(prisma.lead.findMany.mock.calls[0][0].where.source).toBe('META_ADS');
      expect(prisma.lead.findMany.mock.calls[0][0].take).toBe(5000);
    });
  });

  describe('ações em lote', () => {
    it('bulkReassign reusa o reassign unitário (mesmas regras/eventos)', async () => {
      const res = await service.bulkReassign(COMPANY, ['l1', 'l2'], 'seller-2', 'manager-1');
      expect(intake.reassign).toHaveBeenCalledTimes(2);
      expect(intake.reassign).toHaveBeenCalledWith(COMPANY, 'l1', 'seller-2', 'manager-1');
      expect(res).toMatchObject({ ok: 2, failed: 0 });
    });

    it('bulkChangeStage propaga lostReason + categoria (regra do Perdido preservada, #570)', async () => {
      await service.bulkChangeStage(
        COMPANY,
        ['l1'],
        'stage-lost',
        'manager-1',
        'sem resposta',
        'SEM_RESPOSTA' as any,
      );
      expect(crm.changeStage).toHaveBeenCalledWith(
        COMPANY,
        'l1',
        'stage-lost',
        'manager-1',
        'sem resposta',
        'SEM_RESPOSTA',
      );
    });

    it('falha individual não interrompe o lote e vem no resultado', async () => {
      crm.changeStage
        .mockRejectedValueOnce(new Error('Perdido exige motivo'))
        .mockResolvedValueOnce({});
      const res = await service.bulkChangeStage(COMPANY, ['l1', 'l2'], 's1', 'm1');
      expect(res.ok).toBe(1);
      expect(res.failed).toBe(1);
      expect(res.results[0]).toMatchObject({ leadId: 'l1', ok: false, error: 'Perdido exige motivo' });
    });

    it('lote vazio ou acima de 200 → 400', async () => {
      await expect(service.bulkReassign(COMPANY, [], 'u1', 'm1')).rejects.toThrow(
        BadRequestException,
      );
      const many = Array.from({ length: 201 }, (_, i) => `l${i}`);
      await expect(service.bulkReassign(COMPANY, many, 'u1', 'm1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
