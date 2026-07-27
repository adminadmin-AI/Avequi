import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { TriageProcessor } from './triage.processor';

const INCIDENT = {
  id: 'inc1',
  protocol: 'AVQ-000042',
  route: '/app/customers',
  appVersion: 'v1.19.0',
  requestId: 'req-9',
  stackSignature: 'abc123',
  // texto livre com PII para provar a redação
  description: 'Cliente joao@gdr.com.br CPF 123.456.789-01 não salva',
  company: { name: 'GDR Reboques Ltda.' },
};

function ghResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => '' } as unknown as Response;
}

describe('TriageProcessor', () => {
  let processor: TriageProcessor;
  let prisma: any;
  let env: Record<string, string>;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    env = { SUPPORT_GITHUB_TOKEN: 'ghp_test', SUPPORT_GITHUB_REPO: 'owner/repo' };
    prisma = {
      supportIncident: {
        findUnique: jest.fn().mockResolvedValue({ ...INCIDENT }),
        findMany: jest.fn().mockResolvedValue([
          { protocol: 'AVQ-000030', title: 'Erro salvar maria@x.com' },
        ]),
      },
    };
    fetchMock = jest.fn(() => Promise.resolve(ghResponse(204)));
    (global as any).fetch = fetchMock;

    const mod = await Test.createTestingModule({
      providers: [
        TriageProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (k: string, d = '') => env[k] ?? d } },
      ],
    }).compile();
    processor = mod.get(TriageProcessor);
  });

  afterEach(() => {
    delete (global as any).fetch;
    jest.clearAllMocks();
  });

  const job = (incidentId = 'inc1') => ({ data: { incidentId } }) as any;

  it('é no-op sem envs do GitHub (não toca banco nem rede)', async () => {
    env = {};
    await processor.handleTriage(job());
    expect(prisma.supportIncident.findUnique).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('faz repository_dispatch com event_type support-triage', async () => {
    await processor.handleTriage(job());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/owner/repo/dispatches');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.event_type).toBe('support-triage');
    expect(init.headers.Authorization).toBe('Bearer ghp_test');
  });

  it('PAYLOAD REDIGIDO: nem CPF/e-mail do incidente nem título similar cru vão ao GitHub', async () => {
    await processor.handleTriage(job());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const p = body.client_payload;

    // description redigida
    expect(p.description).toContain('[EMAIL]');
    expect(p.description).toContain('[CPF]');
    expect(p.description).not.toMatch(/joao@|123\.456\.789-01/);

    // stack completo NUNCA sai — só a assinatura
    expect(p.stack).toBeUndefined();
    expect(p.stackSignature).toBe('abc123');

    // recentSimilar redigido
    expect(p.recentSimilar[0].protocol).toBe('AVQ-000030');
    expect(p.recentSimilar[0].title).toContain('[EMAIL]');
    expect(JSON.stringify(p.recentSimilar)).not.toContain('maria@x.com');
  });

  it('recentSimilar consulta por mesma rota, status ativo, exceto o próprio', async () => {
    await processor.handleTriage(job());
    expect(prisma.supportIncident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          route: '/app/customers',
          id: { not: 'inc1' },
        }),
        take: 5,
      }),
    );
  });

  it('lança (para o Bull reprocessar) quando o GitHub recusa o dispatch', async () => {
    fetchMock.mockResolvedValue(ghResponse(500));
    await expect(processor.handleTriage(job())).rejects.toThrow(/dispatch recusado/);
  });

  it('incidente inexistente é no-op silencioso', async () => {
    prisma.supportIncident.findUnique.mockResolvedValueOnce(null);
    await processor.handleTriage(job());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
