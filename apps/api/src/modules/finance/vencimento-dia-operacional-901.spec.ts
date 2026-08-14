import { Test } from '@nestjs/testing';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { FinanceService } from './finance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SupplierAdvanceService } from './supplier-advance.service';

/**
 * #901 — "hoje" da operação no financeiro.
 *
 * Dois defeitos com a mesma causa raiz, provados aqui:
 *
 * 1. o cálculo do dia vinha do relógio do processo (UTC em produção), então
 *    entre 21h e meia-noite o sistema já achava que era amanhã;
 * 2. o vencimento gerado pela venda nascia de `new Date()`, carregando hora
 *    real — e, na venda noturna, um dia inteiro adiantado.
 *
 * A regra de negócio, invariável: **vence ontem → OVERDUE; vence hoje → OPEN;
 * vence amanhã → OPEN**, independentemente do fuso do container.
 */
describe('vencimento e dia operacional (#901)', () => {
  let service: FinanceService;
  let prisma: any;

  const congelar = (iso: string) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(iso));
  };

  beforeEach(async () => {
    prisma = {
      financialEntry: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'fe-1', ...data })),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      salesOrder: { findFirst: jest.fn() },
      scheduledPayment: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const mod = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: SupplierAdvanceService, useValue: { applyToPayable: jest.fn().mockResolvedValue(0) } },
      ],
    }).compile();

    service = mod.get(FinanceService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── markOverdue ─────────────────────────────────────────────────────────

  describe('markOverdue — a chave dos vencidos', () => {
    const limiteUsado = () => prisma.financialEntry.updateMany.mock.calls[0][0].where.dueDate.lt;

    it('às 20:59 BRT o corte ainda é o dia de hoje', async () => {
      congelar('2026-08-14T23:59:00.000Z');
      await service.markOverdue();
      expect(limiteUsado().toISOString()).toBe('2026-08-14T00:00:00.000Z');
    });

    it('às 21:01 BRT o corte NÃO pula para amanhã — o bug original', async () => {
      congelar('2026-08-15T00:01:00.000Z');
      await service.markOverdue();
      expect(limiteUsado().toISOString()).toBe('2026-08-14T00:00:00.000Z');
    });

    it('às 23:59 BRT o corte ainda é hoje', async () => {
      congelar('2026-08-15T02:59:00.000Z');
      await service.markOverdue();
      expect(limiteUsado().toISOString()).toBe('2026-08-14T00:00:00.000Z');
    });

    it('às 00:01 BRT do dia seguinte o corte avança', async () => {
      congelar('2026-08-15T03:01:00.000Z');
      await service.markOverdue();
      expect(limiteUsado().toISOString()).toBe('2026-08-15T00:00:00.000Z');
    });

    it('só promove OPEN → OVERDUE, nunca reabre', async () => {
      congelar('2026-08-15T03:01:00.000Z');
      await service.markOverdue();
      const chamada = prisma.financialEntry.updateMany.mock.calls[0][0];
      expect(chamada.where.status).toBe(FinancialEntryStatus.OPEN);
      expect(chamada.data.status).toBe(FinancialEntryStatus.OVERDUE);
    });

    it('vence ontem → alcançado; vence hoje e amanhã → não alcançados', async () => {
      congelar('2026-08-14T12:00:00.000Z');
      await service.markOverdue();
      const limite = limiteUsado().getTime();
      const ontem = new Date('2026-08-13T00:00:00.000Z').getTime();
      const hoje = new Date('2026-08-14T00:00:00.000Z').getTime();
      const amanha = new Date('2026-08-15T00:00:00.000Z').getTime();
      expect(ontem < limite).toBe(true);
      expect(hoje < limite).toBe(false);
      expect(amanha < limite).toBe(false);
    });

    it('título salvo como YYYY-MM-DDT00:00:00Z não vence no próprio dia', async () => {
      congelar('2026-08-14T23:30:00.000Z'); // 20:30 BRT
      await service.markOverdue();
      expect(new Date('2026-08-14T00:00:00.000Z') < limiteUsado()).toBe(false);
    });

    it('virada de mês: 31/08 às 21:30 BRT ainda corta em agosto', async () => {
      congelar('2026-09-01T00:30:00.000Z');
      await service.markOverdue();
      expect(limiteUsado().toISOString()).toBe('2026-08-31T00:00:00.000Z');
    });

    it('virada de ano: 31/12 às 22:00 BRT ainda corta em 2026', async () => {
      congelar('2027-01-01T01:00:00.000Z');
      await service.markOverdue();
      expect(limiteUsado().toISOString()).toBe('2026-12-31T00:00:00.000Z');
    });

    it('o resultado não muda com o fuso do processo', async () => {
      const original = process.env.TZ;
      const limites: string[] = [];
      for (const tz of ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo']) {
        process.env.TZ = tz;
        prisma.financialEntry.updateMany.mockClear();
        congelar('2026-08-15T01:30:00.000Z'); // 22:30 BRT de 14/08
        await service.markOverdue();
        limites.push(limiteUsado().toISOString());
        jest.useRealTimers();
      }
      process.env.TZ = original;
      expect(new Set(limites)).toEqual(new Set(['2026-08-14T00:00:00.000Z']));
    });
  });

  // ── agendamento ─────────────────────────────────────────────────────────

  describe('agendamento do cron', () => {
    /**
     * Trava contra a regressão mais provável desta issue: alguém corrigir o
     * cálculo e remover o fuso do agendamento. Sem o fuso, o cron volta a
     * disparar às 21h de São Paulo — e o erro apenas troca de sinal.
     */
    const metadados = () => {
      const alvo = Object.getPrototypeOf(service).markOverdue;
      return {
        expressao: Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', alvo),
        cronTime: Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', alvo)?.cronTime,
      };
    };

    it('declara timeZone America/Sao_Paulo', () => {
      const opcoes = metadados().expressao;
      expect(opcoes).toBeDefined();
      expect(opcoes.timeZone).toBe('America/Sao_Paulo');
    });

    it('dispara na virada brasileira (03:00Z), não às 00:00Z', () => {
      const { CronJob } = require('cron');
      const opcoes = metadados().expressao;
      const job = new CronJob(opcoes.cronTime, () => {}, null, false, opcoes.timeZone);
      const proxima = job.nextDate().toJSDate();
      expect(proxima.getUTCHours()).toBe(3);
      expect(proxima.getUTCMinutes()).toBe(0);
    });

    it('sem o timeZone o disparo cairia às 21h BRT — prova do porquê da trava', () => {
      const { CronJob } = require('cron');
      const semFuso = new CronJob('0 0 0 * * *', () => {}, null, false, 'UTC');
      expect(semFuso.nextDate().toJSDate().getUTCHours()).toBe(0);
    });
  });

  // ── reconciliação ao editar vencimento ──────────────────────────────────

  describe('reconciliação ao editar o vencimento', () => {
    const entrada = {
      id: 'fe-1',
      companyId: 'co-1',
      status: FinancialEntryStatus.OPEN,
      amount: 100,
      dueDate: new Date('2026-08-20T00:00:00.000Z'),
      description: 'Título',
      type: FinancialEntryType.RECEIVABLE,
    };

    const editarPara = async (novaData: string, statusAtual = FinancialEntryStatus.OPEN) => {
      prisma.financialEntry.findFirst.mockResolvedValue({ ...entrada, status: statusAtual });
      const atualizado = jest.fn().mockResolvedValue({ ...entrada });
      prisma.$transaction = jest.fn(async (fn: any) =>
        fn({
          financialEntry: { update: atualizado },
          entryCostCenterSplit: { deleteMany: jest.fn(), createMany: jest.fn() },
          auditLog: { create: jest.fn() },
        }),
      );
      await service.updateEntry('fe-1', 'co-1', { dueDate: novaData } as any);
      const data = atualizado.mock.calls[0][0].data;
      // O serviço só grava `status` quando ele MUDA — ausência significa
      // "permanece o que já era".
      return data.status ?? statusAtual;
    };

    it('mover para ontem → OVERDUE', async () => {
      congelar('2026-08-14T12:00:00.000Z');
      expect(await editarPara('2026-08-13')).toBe(FinancialEntryStatus.OVERDUE);
    });

    it('mover para hoje → não vencido (OPEN)', async () => {
      congelar('2026-08-14T12:00:00.000Z');
      expect(await editarPara('2026-08-14')).toBe(FinancialEntryStatus.OPEN);
    });

    it('mover para amanhã → OPEN', async () => {
      congelar('2026-08-14T12:00:00.000Z');
      expect(await editarPara('2026-08-15')).toBe(FinancialEntryStatus.OPEN);
    });

    it('às 21:30 BRT, mover para hoje continua OPEN — o bug original', async () => {
      congelar('2026-08-15T00:30:00.000Z'); // 21:30 BRT de 14/08
      expect(await editarPara('2026-08-14')).toBe(FinancialEntryStatus.OPEN);
    });

    /**
     * A ÚNICA reabertura que existe no sistema é esta, na edição manual do
     * vencimento. Não há cron nem job que devolva OVERDUE → OPEN sozinho, e
     * esta issue não cria nenhum (#901).
     */
    it('título OVERDUE reaberto ao adiar o vencimento para hoje', async () => {
      congelar('2026-08-14T12:00:00.000Z');
      expect(await editarPara('2026-08-14', FinancialEntryStatus.OVERDUE)).toBe(
        FinancialEntryStatus.OPEN,
      );
    });

    it('às 21:30 BRT o adiamento para hoje também reabre', async () => {
      congelar('2026-08-15T00:30:00.000Z');
      expect(await editarPara('2026-08-14', FinancialEntryStatus.OVERDUE)).toBe(
        FinancialEntryStatus.OPEN,
      );
    });
  });

  // ── origem: vencimento gerado pela venda ────────────────────────────────

  describe('origem — vencimento gerado pela venda', () => {
    const semPlano = () => prisma.salesOrder.findFirst.mockResolvedValue({ payments: [] });

    const vencimentoGerado = async () => {
      await service.createReceivableForSale({
        companyId: 'co-1',
        salesOrderId: 'ov-1',
        amount: 1000,
      } as any);
      return prisma.financialEntry.create.mock.calls[0][0].data.dueDate as Date;
    };

    it('venda às 14:00 BRT de 14/08 + 30 dias → vence 13/09', async () => {
      semPlano();
      congelar('2026-08-14T17:00:00.000Z');
      expect((await vencimentoGerado()).toISOString()).toBe('2026-09-13T00:00:00.000Z');
    });

    it('venda às 22:30 BRT de 14/08 usa a MESMA data-base — o bug reproduzido', async () => {
      semPlano();
      congelar('2026-08-15T01:30:00.000Z'); // UTC já é 15/08
      expect((await vencimentoGerado()).toISOString()).toBe('2026-09-13T00:00:00.000Z');
    });

    it('vencimento é sempre persistido como data pura 00:00:00.000Z', async () => {
      semPlano();
      congelar('2026-08-15T01:30:00.000Z');
      const venc = await vencimentoGerado();
      expect(venc.toISOString()).toMatch(/T00:00:00\.000Z$/);
    });

    it('prazo que atravessa mês', async () => {
      semPlano();
      congelar('2026-08-25T17:00:00.000Z');
      expect((await vencimentoGerado()).toISOString()).toBe('2026-09-24T00:00:00.000Z');
    });

    it('prazo que atravessa ano', async () => {
      semPlano();
      congelar('2026-12-20T17:00:00.000Z');
      expect((await vencimentoGerado()).toISOString()).toBe('2027-01-19T00:00:00.000Z');
    });

    it('plano parcelado: todas as parcelas nascem como data pura e na base certa', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({
        payments: [{ id: 'sp-1', method: 'BOLETO', installments: 3, amount: 300 }],
      });
      congelar('2026-08-15T01:30:00.000Z'); // 22:30 BRT de 14/08
      await service.createReceivableForSale({
        companyId: 'co-1',
        salesOrderId: 'ov-1',
        amount: 300,
      } as any);
      const criados = prisma.financialEntry.createMany.mock.calls[0][0].data;
      expect(criados).toHaveLength(3);
      expect(criados.map((c: any) => c.dueDate.toISOString())).toEqual([
        '2026-09-13T00:00:00.000Z',
        '2026-10-13T00:00:00.000Z',
        '2026-11-12T00:00:00.000Z',
      ]);
    });

    it('à vista (D+0) vence no próprio dia operacional, não no dia seguinte', async () => {
      prisma.salesOrder.findFirst.mockResolvedValue({
        payments: [{ id: 'sp-2', method: 'PIX', installments: 1, amount: 500 }],
      });
      congelar('2026-08-15T01:30:00.000Z'); // 22:30 BRT de 14/08
      await service.createReceivableForSale({
        companyId: 'co-1',
        salesOrderId: 'ov-2',
        amount: 500,
      } as any);
      const criados = prisma.financialEntry.createMany.mock.calls[0][0].data;
      expect(criados[0].dueDate.toISOString()).toBe('2026-08-14T00:00:00.000Z');
    });

    it('vencimento explícito informado pelo chamador é respeitado', async () => {
      semPlano();
      congelar('2026-08-14T17:00:00.000Z');
      await service.createReceivableForSale({
        companyId: 'co-1',
        salesOrderId: 'ov-3',
        amount: 100,
        dueDate: new Date('2026-10-01T00:00:00.000Z'),
      } as any);
      expect(prisma.financialEntry.create.mock.calls[0][0].data.dueDate.toISOString()).toBe(
        '2026-10-01T00:00:00.000Z',
      );
    });
  });
});
