import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { GithubIssueService } from './github-issue.service';

const INCIDENT = {
  id: 'inc1',
  protocol: 'AVQ-000042',
  source: 'USER_REPORT',
  title: 'Erro ao salvar cliente joao@gdr.com.br',
  description: 'Cliente CPF 123.456.789-01 não salva.\nCNPJ 12.345.678/0001-90.',
  route: '/app/customers',
  appVersion: 'v1.18.0',
  requestId: 'req-9',
  stackSignature: null,
  githubIssueNumber: null,
  company: { name: 'GDR Reboques Ltda.' },
};

/** Response-like para mockar fetch nativo. */
function ghResponse(status: number, json: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  } as unknown as Response;
}

describe('GithubIssueService', () => {
  let service: GithubIssueService;
  let prisma: any;
  let env: Record<string, string>;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    env = {
      SUPPORT_GITHUB_TOKEN: 'ghp_test',
      SUPPORT_GITHUB_REPO: 'owner/repo',
    };
    prisma = {
      supportIncident: {
        findUnique: jest.fn().mockResolvedValue({ ...INCIDENT }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    // fetch nativo mockado: labels responde 201, issues responde 201 com número.
    fetchMock = jest.fn((url: string) => {
      if (String(url).endsWith('/labels')) return Promise.resolve(ghResponse(201));
      return Promise.resolve(ghResponse(201, { number: 777 }));
    });
    (global as any).fetch = fetchMock;

    const mod = await Test.createTestingModule({
      providers: [
        GithubIssueService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d = '') => env[k] ?? d },
        },
      ],
    }).compile();

    service = mod.get(GithubIssueService);
  });

  afterEach(() => {
    delete (global as any).fetch;
    jest.clearAllMocks();
  });

  it('cria issue com título/corpo REDIGIDOS, label do cliente e grava o número', async () => {
    const number = await service.createForIncident('inc1');

    expect(number).toBe(777);

    // garante a label do tenant antes da issue
    const labelCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/labels'));
    expect(labelCall).toBeDefined();
    const labelBody = JSON.parse(labelCall![1].body);
    expect(labelBody.name).toBe('cliente:gdr-reboques-ltda');

    // POST da issue redigido
    const issueCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/issues'));
    expect(issueCall).toBeDefined();
    const [url, init] = issueCall!;
    expect(url).toBe('https://api.github.com/repos/owner/repo/issues');
    const payload = JSON.parse(init.body);
    expect(payload.title).toBe('[SUPORTE] AVQ-000042 — Erro ao salvar cliente [EMAIL]');
    expect(payload.body).toContain('[CPF]');
    expect(payload.body).toContain('[CNPJ]');
    expect(payload.body).not.toMatch(/123\.456\.789-01|joao@|12\.345\.678/);
    expect(payload.labels).toEqual(['suporte', 'cliente:gdr-reboques-ltda']);
    expect(init.headers.Authorization).toBe('Bearer ghp_test');

    expect(prisma.supportIncident.update).toHaveBeenCalledWith({
      where: { id: 'inc1' },
      data: { githubIssueNumber: 777 },
    });
  });

  it('é no-op sem SUPPORT_GITHUB_TOKEN/REPO (não toca banco nem rede)', async () => {
    env = {};
    const number = await service.createForIncident('inc1');
    expect(number).toBeNull();
    expect(prisma.supportIncident.findUnique).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('é idempotente: incidente que já tem issue não cria outra', async () => {
    prisma.supportIncident.findUnique.mockResolvedValueOnce({
      ...INCIDENT,
      githubIssueNumber: 123,
    });
    const number = await service.createForIncident('inc1');
    expect(number).toBe(123);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.supportIncident.update).not.toHaveBeenCalled();
  });

  it('ignora incidente inexistente', async () => {
    prisma.supportIncident.findUnique.mockResolvedValueOnce(null);
    const number = await service.createForIncident('nope');
    expect(number).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('erro de rede na criação da issue NÃO propaga (retorna null, não grava)', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith('/labels')) return Promise.resolve(ghResponse(201));
      return Promise.reject(new Error('ECONNRESET'));
    });
    await expect(service.createForIncident('inc1')).resolves.toBeNull();
    expect(prisma.supportIncident.update).not.toHaveBeenCalled();
  });

  it('label já existente (422) é ignorada e a issue é criada mesmo assim', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith('/labels')) return Promise.resolve(ghResponse(422));
      return Promise.resolve(ghResponse(201, { number: 999 }));
    });
    const number = await service.createForIncident('inc1');
    expect(number).toBe(999);
    expect(prisma.supportIncident.update).toHaveBeenCalledWith({
      where: { id: 'inc1' },
      data: { githubIssueNumber: 999 },
    });
  });

  it('GitHub recusa a issue (não-2xx) → retorna null e não grava', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith('/labels')) return Promise.resolve(ghResponse(201));
      return Promise.resolve(ghResponse(403));
    });
    const number = await service.createForIncident('inc1');
    expect(number).toBeNull();
    expect(prisma.supportIncident.update).not.toHaveBeenCalled();
  });

  describe('commentDiagnosis (WP4 #768)', () => {
    const DIAG = {
      probableCause: 'Cliente joao@gdr.com.br não persiste (CPF 123.456.789-01)',
      files: [{ path: 'customer.service.ts', line: 42, reason: 'valida e-mail joao@gdr.com.br' }],
      module: 'customer',
      severity: 'P1' as const,
      isDuplicateOf: null,
      confidence: 0.9,
      suggestedFix: 'tratar telefone (11) 99999-8888',
      safeSelfServiceStep: null,
      needsHuman: true,
    };

    it('comenta na issue com o diagnóstico e REDIGE o texto livre do LLM', async () => {
      fetchMock.mockResolvedValue(ghResponse(201));
      const ok = await service.commentDiagnosis(55, DIAG);
      expect(ok).toBe(true);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.github.com/repos/owner/repo/issues/55/comments');
      const body = JSON.parse(init.body).body;
      expect(body).toContain('P1');
      expect(body).toContain('PRECISA DE HUMANO');
      // PII do texto livre redigida
      expect(body).toContain('[EMAIL]');
      expect(body).toContain('[CPF]');
      expect(body).toContain('[TELEFONE]');
      expect(body).not.toMatch(/joao@gdr|123\.456\.789-01|99999-8888/);
    });

    it('é no-op sem config (retorna false, não toca rede)', async () => {
      env = {};
      const ok = await service.commentDiagnosis(55, DIAG);
      expect(ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('erro de rede NÃO propaga (retorna false)', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));
      await expect(service.commentDiagnosis(55, DIAG)).resolves.toBe(false);
    });
  });
});
