import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  SessionDenylistService,
  SESSION_DENYLIST_TTL_SECONDS,
  parseExpiryToSeconds,
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

  describe('TTL cobre a vida do access token (#823)', () => {
    it('parseExpiryToSeconds cobre TODOS os formatos que o Joi do boot permite', () => {
      // env.validation.ts: JWT_EXPIRY_PATTERN = /^\d+(ms|s|m|h|d|w|y)?$/
      expect(parseExpiryToSeconds('15m')).toBe(900);
      expect(parseExpiryToSeconds('1h')).toBe(3600);
      expect(parseExpiryToSeconds('900s')).toBe(900);
      expect(parseExpiryToSeconds('900')).toBe(900);
      expect(parseExpiryToSeconds('1d')).toBe(86400);
      expect(parseExpiryToSeconds('2w')).toBe(1209600);
      expect(parseExpiryToSeconds('1y')).toBe(31536000);
      expect(parseExpiryToSeconds('500ms')).toBe(1); // arredonda p/ cima, nunca 0
    });

    it('formato desconhecido/ausente cai no fallback de 15 min (nunca zero)', () => {
      expect(parseExpiryToSeconds(undefined)).toBe(SESSION_DENYLIST_TTL_SECONDS);
      expect(parseExpiryToSeconds('banana')).toBe(SESSION_DENYLIST_TTL_SECONDS);
      expect(parseExpiryToSeconds('')).toBe(SESSION_DENYLIST_TTL_SECONDS);
    });

    it('JWT_EXPIRY maior que 15 min → TTL acompanha (entrada nunca expira antes do token)', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SessionDenylistService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn((k: string) => (k === 'JWT_EXPIRY' ? '1h' : undefined)) },
          },
        ],
      }).compile();
      const svc = module.get(SessionDenylistService);
      (svc as any).client = mockRedis;

      await svc.deny('sess-1');

      expect(mockRedis.set).toHaveBeenCalledWith('iam:session-denylist:sess-1', '1', 'EX', 3600);
    });

    it('JWT_EXPIRY menor que 15 min → TTL não desce do piso de 15 min', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SessionDenylistService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn((k: string) => (k === 'JWT_EXPIRY' ? '5m' : undefined)) },
          },
        ],
      }).compile();
      const svc = module.get(SessionDenylistService);
      (svc as any).client = mockRedis;

      await svc.deny('sess-1');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'iam:session-denylist:sess-1',
        '1',
        'EX',
        SESSION_DENYLIST_TTL_SECONDS,
      );
    });
  });

  describe('isSessionDenylisted — consulta da JwtStrategy (#823)', () => {
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

    it('falha na consulta emite log estruturado ERROR uma vez, sem token/sessionId (#823)', async () => {
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation();
      mockRedis.get.mockRejectedValue(new Error('ECONNREFUSED'));

      await service.isSessionDenylisted('sess-1');
      await service.isSessionDenylisted('sess-2'); // segunda falha na MESMA indisponibilidade

      expect(errorSpy).toHaveBeenCalledTimes(1); // uma vez por indisponibilidade
      const logged = errorSpy.mock.calls[0][0] as string;
      expect(logged).toContain('session_denylist_unavailable');
      expect(logged).toContain('fail-open');
      expect(logged).not.toContain('sess-1'); // nunca loga sessionId/JWT
      errorSpy.mockRestore();
    });

    it('sem client (Redis nunca subiu) devolve false / no-op', async () => {
      (service as any).client = null;
      (service as any).clientFailed = true;

      await expect(service.isSessionDenylisted('sess-1')).resolves.toBe(false);
      await expect(service.deny('sess-1')).resolves.toBeUndefined();
    });
  });
});
