import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupportIncidentSource, SupportIncidentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportService, SUPPORT_INCIDENT_CAPTURED } from './support.service';

describe('SupportService', () => {
  let service: SupportService;
  let prisma: any;
  let events: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      supportIncident: {
        count: jest.fn().mockResolvedValue(41),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'inc1', createdAt: new Date(), ...data }),
          ),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest
          .fn()
          .mockResolvedValue({ id: 'inc1', protocol: 'AVQ-000042', githubIssueNumber: 7 }),
      },
    };
    events = { emit: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();

    service = mod.get(SupportService);
  });

  it('cria chamado com protocolo sequencial, status NEW e source USER_REPORT', async () => {
    const res = await service.createIncident(
      'c1',
      { title: 'Erro na venda' } as any,
      'u1',
    );
    expect(prisma.supportIncident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'c1',
          reportedById: 'u1',
          source: SupportIncidentSource.USER_REPORT,
          status: SupportIncidentStatus.NEW,
          protocol: 'AVQ-000042',
          title: 'Erro na venda',
        }),
      }),
    );
    expect(res.protocol).toBe('AVQ-000042');
  });

  it('emite support.incident.captured no create', async () => {
    await service.createIncident('c1', { title: 'x' } as any, 'u1');
    expect(events.emit).toHaveBeenCalledWith(
      SUPPORT_INCIDENT_CAPTURED,
      expect.objectContaining({ companyId: 'c1' }),
    );
  });

  it('retenta o protocolo em colisão de unique (P2002)', async () => {
    prisma.supportIncident.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockImplementationOnce(({ data }: any) =>
        Promise.resolve({ id: 'inc2', createdAt: new Date(), ...data }),
      );
    const res = await service.createIncident('c1', { title: 'x' } as any, 'u1');
    expect(res.protocol).toBe('AVQ-000043'); // 41 + 1 + attempt(1)
    expect(prisma.supportIncident.create).toHaveBeenCalledTimes(2);
  });

  it('listMine filtra pelos chamados do próprio usuário', async () => {
    await service.listMine('c1', 'u1');
    expect(prisma.supportIncident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1', reportedById: 'u1' } }),
    );
  });

  it('listMine NÃO expõe diagnosis nem triagedAt (campos internos do épico)', async () => {
    await service.listMine('c1', 'u1');
    const args = prisma.supportIncident.findMany.mock.calls[0][0];
    expect(args.select.diagnosis).toBeUndefined();
    expect(args.select.triagedAt).toBeUndefined();
    // sanity: campos internos do WP3 também seguem fora
    expect(args.select.githubIssueNumber).toBeUndefined();
    expect(args.select.stackSignature).toBeUndefined();
    // severity É cliente-facing por design (preenchido pela triagem)
    expect(args.select.severity).toBe(true);
  });

  it('applyDiagnosis grava diagnosis+triagedAt+severity e retorna o vínculo da issue', async () => {
    const dto = {
      probableCause: 'null deref',
      files: [{ path: 'a.ts', line: 10, reason: 'x' }],
      module: 'sales',
      severity: 'P1',
      isDuplicateOf: null,
      confidence: 0.8,
      suggestedFix: null,
      safeSelfServiceStep: null,
      needsHuman: false,
    } as any;

    const res = await service.applyDiagnosis('inc1', dto);

    expect(prisma.supportIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc1' },
        data: expect.objectContaining({
          diagnosis: dto,
          triagedAt: expect.any(Date),
          severity: 'P1',
        }),
      }),
    );
    // Não toca em status (transição é fluxo separado, afeta dedup)
    expect(prisma.supportIncident.update.mock.calls[0][0].data.status).toBeUndefined();
    expect(res.githubIssueNumber).toBe(7);
  });

  it('captureAutoError cria incidente AUTO_ERROR quando nao ha duplicado', async () => {
    await service.captureAutoError({
      companyId: 'c1',
      errorName: 'TypeError',
      errorMessage: 'x is undefined',
      stack: 'TypeError: x is undefined\n  at Foo (/app/src/foo.ts:10:5)',
      route: '/api/sales',
      requestId: 'req-9',
    });
    expect(prisma.supportIncident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'c1',
          source: SupportIncidentSource.AUTO_ERROR,
          reportedById: null,
          stackSignature: expect.any(String),
        }),
      }),
    );
  });

  it('captureAutoError deduplica: nao cria se ja ha incidente ativo de mesma assinatura', async () => {
    prisma.supportIncident.findFirst.mockResolvedValueOnce({ id: 'existing' });
    await service.captureAutoError({
      companyId: 'c1',
      errorName: 'TypeError',
      errorMessage: 'x is undefined',
      stack: 'TypeError: x is undefined',
    });
    expect(prisma.supportIncident.create).not.toHaveBeenCalled();
  });

  it('captureAutoError ignora erro sem tenant (companyId ausente)', async () => {
    await service.captureAutoError({ errorName: 'Error', errorMessage: 'boom' });
    expect(prisma.supportIncident.findFirst).not.toHaveBeenCalled();
    expect(prisma.supportIncident.create).not.toHaveBeenCalled();
  });
});
