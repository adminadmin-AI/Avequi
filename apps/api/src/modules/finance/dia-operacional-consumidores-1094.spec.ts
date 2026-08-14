import { Test } from '@nestjs/testing';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { CollectionRuleService } from './collection-rule.service';
import { ProvisionService } from './provision.service';
import { ManagementBookService } from './management-book.service';
import { FinanceKpiService } from './finance-kpi.service';
import { DebtService } from './debt.service';
import { FinanceService } from './finance.service';
import { SupplierAdvanceService } from './supplier-advance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { diferencaEmDias, formatarDataPura } from '../../common/date/dia-operacional';

/**
 * #1094 — os consumidores financeiros que ainda calculavam "hoje" pelo relógio
 * do processo (continuação da #901).
 *
 * O container roda em UTC, três horas à frente de São Paulo: entre 21h e
 * meia-noite todo título ganhava artificialmente **um dia de atraso**. Um dia
 * a mais muda a faixa do aging, o percentual de provisão e o estágio da régua
 * de cobrança — e a régua GRAVA: registra cobrança e pode bloquear o
 * faturamento do cliente.
 *
 * Todos os testes congelam o relógio. A janela crítica é 21h–00h BRT, que em
 * UTC já é o dia seguinte.
 */

const congelar = (iso: string) => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(iso));
};

/** Vencimento como o banco guarda: data pura à meia-noite UTC. */
const venc = (dia: string) => new Date(`${dia}T00:00:00.000Z`);

// Instantes de referência — 14/08/2026 no relógio de São Paulo.
const ANTES_DAS_21 = '2026-08-14T23:59:00.000Z'; // 20:59 BRT
const DEPOIS_DAS_21 = '2026-08-15T00:01:00.000Z'; // 21:01 BRT
const QUASE_MEIA_NOITE = '2026-08-15T02:59:00.000Z'; // 23:59 BRT
const DIA_SEGUINTE = '2026-08-15T03:01:00.000Z'; // 00:01 BRT de 15/08

describe('dia operacional nos consumidores financeiros (#1094)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── Dias de atraso: a base de tudo ───────────────────────────────────────

  describe('dias de atraso — título vencido ontem (13/08)', () => {
    const casos: [string, string, number][] = [
      ['20:59 BRT', ANTES_DAS_21, 1],
      ['21:01 BRT — a janela do bug', DEPOIS_DAS_21, 1],
      ['23:59 BRT', QUASE_MEIA_NOITE, 1],
      ['00:01 BRT do dia seguinte', DIA_SEGUINTE, 2],
    ];

    it.each(casos)('às %s → %s dias', (_rotulo, instante, esperado) => {
      congelar(instante);
      const { dataOperacionalHoje } = require('../../common/date/dia-operacional');
      expect(diferencaEmDias(formatarDataPura(venc('2026-08-13')), dataOperacionalHoje())).toBe(
        esperado,
      );
    });

    it('não depende do fuso do processo', () => {
      const original = process.env.TZ;
      const resultados: number[] = [];
      for (const tz of ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo']) {
        process.env.TZ = tz;
        congelar(DEPOIS_DAS_21);
        const { dataOperacionalHoje } = require('../../common/date/dia-operacional');
        resultados.push(diferencaEmDias(formatarDataPura(venc('2026-08-13')), dataOperacionalHoje()));
        jest.useRealTimers();
      }
      process.env.TZ = original;
      expect(new Set(resultados)).toEqual(new Set([1]));
    });
  });

  // ── 1. Régua de cobrança — o único que GRAVA ─────────────────────────────

  describe('régua de cobrança', () => {
    let service: CollectionRuleService;
    let prisma: any;

    /** Régua real: 1º aviso a partir de 1 dia; jurídico + bloqueio a partir de 2. */
    const REGRAS = [
      { id: 'r1', companyId: 'co-1', stage: 'AVISO', daysFrom: 1, daysTo: 1, channels: ['EMAIL'], escalate: false, autoBlock: false, isActive: true },
      { id: 'r2', companyId: 'co-1', stage: 'LEGAL', daysFrom: 2, daysTo: 30, channels: ['EMAIL'], escalate: true, autoBlock: true, isActive: true },
    ];

    const TITULO = {
      id: 'fe-1',
      amount: 1000,
      dueDate: venc('2026-08-13'), // venceu ONTEM → 1 dia de atraso
      description: 'Título',
      salesOrder: {
        customerId: 'cli-1',
        customer: { name: 'Cliente Teste', billingBlocked: false },
      },
    };

    beforeEach(async () => {
      prisma = {
        collectionRule: { findMany: jest.fn().mockResolvedValue(REGRAS) },
        financialEntry: { findMany: jest.fn().mockResolvedValue([TITULO]) },
        collectionAttempt: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
        customer: { update: jest.fn().mockResolvedValue({}) },
      };
      const mod = await Test.createTestingModule({
        providers: [CollectionRuleService, { provide: PrismaService, useValue: prisma }],
      }).compile();
      service = mod.get(CollectionRuleService);
    });

    const notaGravada = () => prisma.collectionAttempt.create.mock.calls[0][0].data.note as string;

    it('às 22h BRT NÃO avança de estágio — fica no AVISO, não vai ao jurídico', async () => {
      congelar('2026-08-15T01:00:00.000Z'); // 22:00 BRT de 14/08
      await service.run('co-1');
      expect(notaGravada()).toContain('[REGUA:AVISO]');
      expect(notaGravada()).toContain('1d de atraso');
      expect(notaGravada()).not.toContain('JURÍDICO');
    });

    it('às 22h BRT NÃO bloqueia o faturamento do cliente', async () => {
      congelar('2026-08-15T01:00:00.000Z');
      const resultado = await service.run('co-1');
      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(resultado.blocked).toBe(0);
    });

    it('às 14h BRT o resultado é idêntico — a hora do dia não altera nada', async () => {
      congelar('2026-08-14T17:00:00.000Z');
      await service.run('co-1');
      expect(notaGravada()).toContain('[REGUA:AVISO]');
      expect(notaGravada()).toContain('1d de atraso');
    });

    it('no dia seguinte, aí sim escala para o jurídico e bloqueia — comportamento preservado', async () => {
      congelar(DIA_SEGUINTE); // 00:01 BRT de 15/08 → 2 dias de atraso
      const resultado = await service.run('co-1');
      expect(notaGravada()).toContain('[REGUA:LEGAL]');
      expect(notaGravada()).toContain('2d de atraso');
      expect(prisma.customer.update).toHaveBeenCalled();
      expect(resultado.blocked).toBe(1);
    });

    it('título a vencer continua sendo anunciado como pré-vencimento', async () => {
      prisma.collectionRule.findMany.mockResolvedValue([
        { ...REGRAS[0], stage: 'PRE', daysFrom: -3, daysTo: -1 },
      ]);
      prisma.financialEntry.findMany.mockResolvedValue([{ ...TITULO, dueDate: venc('2026-08-16') }]);
      congelar('2026-08-15T01:00:00.000Z'); // 22h BRT de 14/08
      await service.run('co-1');
      expect(notaGravada()).toContain('vence em 2d');
    });

    it('a janela de busca no banco também parte do dia operacional', async () => {
      congelar('2026-08-15T01:00:00.000Z'); // 22h BRT de 14/08
      await service.run('co-1');
      const maxDue = prisma.financialEntry.findMany.mock.calls[0][0].where.dueDate.lte as Date;
      // minFrom = 1 → hoje (14/08) menos 1 dia
      expect(maxDue.toISOString()).toBe('2026-08-13T00:00:00.000Z');
    });
  });

  // ── 2. Provisão / PDD ────────────────────────────────────────────────────

  describe('provisão (PDD)', () => {
    let service: ProvisionService;
    let prisma: any;

    /** Fronteira de faixa: 30 dias fecha a faixa de 5%; 31 já é 20%. */
    const REGRAS = [
      { daysFrom: 1, daysTo: 30, percentage: 5 },
      { daysFrom: 31, daysTo: 90, percentage: 20 },
    ];

    const montar = async (dueDate: Date) => {
      prisma = {
        provisionRule: { findMany: jest.fn().mockResolvedValue(REGRAS) },
        financialEntry: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'fe-1', amount: 1000, paidAmount: 0, dueDate, description: 'T', salesOrder: { customer: { id: 'c1', name: 'Cliente' } } },
          ]),
        },
      };
      const mod = await Test.createTestingModule({
        providers: [ProvisionService, { provide: PrismaService, useValue: prisma }],
      }).compile();
      service = mod.get(ProvisionService);
      return service.getPdd('co-1');
    };

    it('título com 30 dias às 22h BRT continua na faixa de 5% — não pula para 20%', async () => {
      congelar('2026-08-15T01:00:00.000Z'); // 22h BRT de 14/08
      const pdd = await montar(venc('2026-07-15')); // 30 dias antes de 14/08
      expect(pdd.detalhes[0].diasAtraso).toBe(30);
      expect(pdd.detalhes[0].percentual).toBe(5);
      expect(pdd.totalProvisao).toBe(50);
    });

    it('o mesmo título às 14h BRT dá exatamente o mesmo resultado', async () => {
      congelar('2026-08-14T17:00:00.000Z');
      const pdd = await montar(venc('2026-07-15'));
      expect(pdd.detalhes[0].diasAtraso).toBe(30);
      expect(pdd.totalProvisao).toBe(50);
    });

    it('no dia seguinte vira 31 dias e sobe para 20% — fronteira preservada', async () => {
      congelar(DIA_SEGUINTE);
      const pdd = await montar(venc('2026-07-15'));
      expect(pdd.detalhes[0].diasAtraso).toBe(31);
      expect(pdd.detalhes[0].percentual).toBe(20);
      expect(pdd.totalProvisao).toBe(200);
    });

    it('a referência do relatório é o dia da operação', async () => {
      congelar('2026-08-15T01:00:00.000Z');
      const pdd = await montar(venc('2026-07-15'));
      expect(pdd.referencia).toBe('2026-08-14');
    });

    it('título que vence hoje não entra na provisão', async () => {
      congelar('2026-08-15T01:00:00.000Z');
      await montar(venc('2026-08-14'));
      const lt = prisma.financialEntry.findMany.mock.calls[0][0].where.dueDate.lt as Date;
      expect(lt.toISOString()).toBe('2026-08-14T00:00:00.000Z');
      expect(venc('2026-08-14') < lt).toBe(false);
    });
  });

  // ── 3. Aging do livro gerencial ──────────────────────────────────────────

  describe('aging do livro gerencial', () => {
    let service: ManagementBookService;
    let prisma: any;

    const montar = async (dueDate: Date) => {
      prisma = {
        financialEntry: {
          findMany: jest.fn().mockResolvedValue([
            { type: FinancialEntryType.RECEIVABLE, amount: 1000, paidAmount: 0, dueDate },
          ]),
        },
        salesOrder: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const mod = await Test.createTestingModule({
        providers: [
          ManagementBookService,
          { provide: PrismaService, useValue: prisma },
          { provide: FinanceService, useValue: {} },
          { provide: FinanceKpiService, useValue: {} },
          { provide: ProvisionService, useValue: {} },
          { provide: DebtService, useValue: {} },
        ],
      }).compile();
      service = mod.get(ManagementBookService);
      return (service as any).aging('co-1');
    };

    const faixaComValor = (buckets: any[]) => buckets.find((b) => b.receber > 0)?.faixa;

    it('às 22h BRT o título não muda de faixa antecipadamente', async () => {
      congelar('2026-08-15T01:00:00.000Z'); // 22h BRT de 14/08
      const noite = faixaComValor(await montar(venc('2026-07-15')));
      jest.useRealTimers();
      congelar('2026-08-14T17:00:00.000Z'); // 14h BRT do MESMO dia
      const tarde = faixaComValor(await montar(venc('2026-07-15')));
      expect(noite).toBe(tarde);
    });

    it('título que vence hoje fica fora do aging', async () => {
      congelar('2026-08-15T01:00:00.000Z');
      await montar(venc('2026-08-14'));
      const lt = prisma.financialEntry.findMany.mock.calls[0][0].where.dueDate.lt as Date;
      expect(lt.toISOString()).toBe('2026-08-14T00:00:00.000Z');
    });

    it('virada de mês: 31/08 às 21:30 BRT ainda corta em agosto', async () => {
      congelar('2026-09-01T00:30:00.000Z');
      await montar(venc('2026-08-01'));
      const lt = prisma.financialEntry.findMany.mock.calls[0][0].where.dueDate.lt as Date;
      expect(lt.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    });

    it('virada de ano: 31/12 às 22h BRT ainda corta em 2026', async () => {
      congelar('2027-01-01T01:00:00.000Z');
      await montar(venc('2026-12-01'));
      const lt = prisma.financialEntry.findMany.mock.calls[0][0].where.dueDate.lt as Date;
      expect(lt.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    });
  });

  // ── 4 e 5. Monitor de cobrança e fluxo de caixa ──────────────────────────

  describe('monitor de cobrança e fluxo de caixa', () => {
    let service: FinanceService;
    let prisma: any;

    beforeEach(async () => {
      prisma = {
        financialEntry: { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: 0 }) },
        receivable: { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: 0 }) },
        bankAccount: { findMany: jest.fn().mockResolvedValue([{ balance: 0 }]) },
        collectionAttempt: { count: jest.fn().mockResolvedValue(0) },
        debtInstallment: { findMany: jest.fn().mockResolvedValue([]) },
        scheduledPayment: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      };
      const mod = await Test.createTestingModule({
        providers: [
          FinanceService,
          { provide: PrismaService, useValue: prisma },
          { provide: SupplierAdvanceService, useValue: { applyToPayable: jest.fn() } },
        ],
      }).compile();
      service = mod.get(FinanceService);
    });

    it('monitor: dias de atraso não ganham um dia às 22h BRT', async () => {
      prisma.financialEntry.findMany.mockResolvedValue([
        { id: 'fe-1', amount: 100, dueDate: venc('2026-08-13'), status: FinancialEntryStatus.OVERDUE, salesOrder: { customer: { name: 'C' } }, collectionAttempts: [] },
      ]);
      congelar('2026-08-15T01:00:00.000Z');
      const status: any = await service.getCollectionStatus('co-1');
      expect(status[0].daysOverdue).toBe(1);
    });

    it('fluxo de caixa: a janela começa no dia operacional, não no dia UTC', async () => {
      congelar('2026-08-15T01:00:00.000Z'); // 22h BRT de 14/08
      const proj: any = await service.getCashFlowProjection('co-1', { days: 2 });
      expect(proj.projection.map((p: any) => p.date)).toEqual([
        '2026-08-14',
        '2026-08-15',
        '2026-08-16',
      ]);
    });

    it('fluxo de caixa: título casa com o dia certo da projeção', async () => {
      prisma.financialEntry.findMany.mockResolvedValue([
        { type: FinancialEntryType.RECEIVABLE, amount: 500, paidAmount: 0, dueDate: venc('2026-08-15') },
      ]);
      congelar('2026-08-15T01:00:00.000Z');
      const proj: any = await service.getCashFlowProjection('co-1', { days: 2 });
      const dia15 = proj.projection.find((p: any) => p.date === '2026-08-15');
      expect(dia15.receivable).toBe(500);
    });

    it('relatório diário: a janela de RECEBIMENTOS usa o instante físico, não a data pura', async () => {
      congelar('2026-08-15T01:00:00.000Z'); // 22h BRT de 14/08
      await service.getDailyCollectionReport('co-1');
      const chamadas = prisma.financialEntry.aggregate.mock.calls.map((c: any[]) => c[0].where);
      const janela = chamadas.find((w: any) => w.paidAt);
      // 14/08 em São Paulo começa às 03:00Z e termina às 03:00Z de 15/08
      expect(janela.paidAt.gte.toISOString()).toBe('2026-08-14T03:00:00.000Z');
      expect(janela.paidAt.lt.toISOString()).toBe('2026-08-15T03:00:00.000Z');
    });
  });
});
