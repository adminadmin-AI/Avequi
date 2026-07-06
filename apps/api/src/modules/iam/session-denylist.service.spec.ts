import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  SessionDenylistService,
  SESSION_DENYLIST_TTL_SECONDS,
} from './session-denylist.service';

/**
 * Testes do SessionDenylistService (#342) — client ioredis mockado por
 * injeção direta (nenhuma conexão real), mesmo padrão do
 * PermissionCacheService. Foco: contrato de chave/TTL e fail-open
 * (Redis fora do ar nunca lança, nunca bloqueia).
 */

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  disconnect: jest.fn(),
};

describe('SessionDenylistService', () => {
  let service: SessionDenylistService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionDenylistService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(SessionDenylistService);
    jest.clearAllMocks();
    // Injeta o client mockado (evita conexão real do getClient)
    (service as any).client = mockRedis;
  });

  describe('deny — contrato de chave e TTL', () => {
    it('grava iam:session-denylist:{sessionId} com TTL da vida do access token', async () => {
      await service.deny('sess-1');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'iam:session-denylist:sess-1',
        '1',
        'EX',
        SESSION_DENYLIST_TTL_SECONDS,
      );
      expect(SESSION_DENYLIST_TTL_SECONDS).toBe(900); // 15 min
    });

    it('aceita TTL customizado (vida restante do token)', async () => {
      await service.deny('sess-1', 120);

      expect(mockRedis.set).toHaveBeenCalledWith('iam:session-denylist:sess-1', '1', 'EX', 120);
    });
  });

  describe('isSessionDenylisted — consulta do JwtAuthGuard (#341)', () => {
    it('true quando a sessão está na denylist', async () => {
      mockRedis.get.mockResolvedValue('1');

      await expect(service.isSessionDenylisted('sess-1')).resolves.toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith('iam:session-denylist:sess-1');
    });

    it('false quando não está', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.isSessionDenylisted('sess-1')).resolves.toBe(false);
    });

    it('false para sessionId vazio (tokens legados sem claim)', async () => {
      await expect(service.isSessionDenylisted('')).resolves.toBe(false);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });

  describe('fail-open — Redis fora do ar nunca derruba request', () => {
    it('deny com erro de Redis vira no-op', async () => {
      mockRedis.set.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.deny('sess-1')).resolves.toBeUndefined();
    });

    it('isSessionDenylisted com erro de Redis devolve false', async () => {
      mockRedis.get.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.isSessionDenylisted('sess-1')).resolves.toBe(false);
    });

    it('sem client (Redis nunca subiu) devolve false / no-op', async () => {
      (service as any).client = null;
      (service as any).clientFailed = true;

      await expect(service.isSessionDenylisted('sess-1')).resolves.toBe(false);
      await expect(service.deny('sess-1')).resolves.toBeUndefined();
    });
  });
});
