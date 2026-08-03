import { Test, TestingModule } from '@nestjs/testing';
import { FiscalStatus, SupportIncidentSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  METERING_BACKFILL_DAYS,
  UsageMeteringService,
  utcDayStart,
} from './usage-metering.service';

/**
 * OPS WP3 (#910) — metering diário.
 * Contratos: upsert por (tenant raiz, dia) — idempotente; soma a ÁRVORE
 * (matriz + filiais); cron faz backfill de 90d na primeira execução e nunca
 * derruba o app em erro.
 */

const mockPrisma = {
  company: { findMany: jest.fn() },
  tenantUsageDaily: { upsert: jest.fn(), findFirst: jest.fn() },
  userSession: { findMany: jest.fn() },
  fiscalDocument: { count: jest.fn() },
  lead: { count: jest.fn() },
  supportIncident: { count: jest.fn() },
};

describe('UsageMeteringService (OPS WP3 #910)', () => {
  let service: UsageMeteringService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageMeteringService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(UsageMeteringService);
    jest.clearAllMocks();
    mockPrisma.company.findMany.mockResolvedValue([
      { id: 'root-1', branches: [{ id: 'filial-1' }, { id: 'filial-2' }] },
    ]);
    mockPrisma.userSession.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    mockPrisma.fiscalDocument.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
    mockPrisma.lead.count.mockResolvedValue(3);
    mockPrisma.supportIncident.count.mockResolvedValue(0);
    mockPrisma.tenantUsageDaily.upsert.mockResolvedValue({});
  });

  it('agrega a ÁRVORE do tenant (matriz + filiais) e grava por upsert no dia', async () => {
    const day = utcDayStart(new Date('2026-08-01T15:30:00Z'));
    await service.aggregateDay(day);

    // consultas filtram pela árvore inteira
    expect(mockPrisma.userSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: { in: ['root-1', 'filial-1', 'filial-2'] },
        }),
      }),
    );
    // NF-e autorizada conta por authorizedAt; rejeitada por createdAt
    expect(mockPrisma.fiscalDocument.count).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          status: FiscalStatus.AUTHORIZED,
          authorizedAt: expect.anything(),
        }),
      }),
    );
    // 5xx só source AUTO_ERROR (#766)
    expect(mockPrisma.supportIncident.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ source: SupportIncidentSource.AUTO_ERROR }),
      }),
    );
    // upsert na RAIZ com o dia normalizado (idempotência)
    expect(mockPrisma.tenantUsageDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_date: { companyId: 'root-1', date: day } },
        update: expect.objectContaining({ activeUsers: 2, nfeIssued: 5, nfeRejected: 1, crmLeads: 3 }),
        create: expect.objectContaining({ companyId: 'root-1', date: day }),
      }),
    );
  });

  it('runDaily: tabela vazia → backfill de 90 dias', async () => {
    mockPrisma.tenantUsageDaily.findFirst.mockResolvedValue(null);
    const backfillSpy = jest
      .spyOn(service, 'backfill')
      .mockResolvedValue(METERING_BACKFILL_DAYS);
    await service.runDaily();
    expect(backfillSpy).toHaveBeenCalledWith(METERING_BACKFILL_DAYS);
  });

  it('runDaily: tabela populada → agrega só ontem', async () => {
    mockPrisma.tenantUsageDaily.findFirst.mockResolvedValue({ id: 'x' });
    const aggSpy = jest.spyOn(service, 'aggregateDay').mockResolvedValue(undefined);
    await service.runDaily();
    expect(aggSpy).toHaveBeenCalledTimes(1);
    const day = aggSpy.mock.calls[0][0];
    expect(day.getUTCHours()).toBe(0); // dia normalizado UTC
  });

  it('runDaily: erro na agregação NÃO propaga (cron nunca derruba o app)', async () => {
    mockPrisma.tenantUsageDaily.findFirst.mockRejectedValue(new Error('db down'));
    await expect(service.runDaily()).resolves.toBeUndefined();
  });

  it('utcDayStart normaliza para 00:00 UTC', () => {
    const d = utcDayStart(new Date('2026-08-02T23:59:59.999Z'));
    expect(d.toISOString()).toBe('2026-08-02T00:00:00.000Z');
  });
});
