import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionDenylistService } from './session-denylist.service';
import { SessionService } from './session.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AccessSessionPolicy } from './access-session-policy.service';

/**
 * Integração da cadeia de revogação (#823):
 *
 *   revokeAllSessions(userId, SECURITY)
 *     → SessionDenylistService.deny(sessionId)
 *       → JwtStrategy.validate(payload com sessionId) rejeita com 401
 *
 * SessionService e JwtStrategy REAIS; Prisma mockado; denylist com um store
 * em memória no lugar do Redis (mesma semântica de deny/consulta). Não é um
 * mock de expectativa: o sessionId gravado pela revogação é o MESMO
 * consultado pela strategy — se qualquer elo desalinhar (chave, reason não
 * crítico, consulta ausente), o teste quebra.
 *
 * Cobre as três origens de revogação crítica por SECURITY: inativação de
 * usuário (#744), troca de senha (#743/#345) e reset administrativo (#824 —
 * fixture compartilhada; este spec não depende do código do #824, apenas
 * prova que revokeAllSessions(alvo, SECURITY) derruba o access token).
 */

const mockPrisma = {
  userSession: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    updateMany: jest.fn(),
  },
  securityEvent: {
    create: jest.fn(),
  },
};

describe('cadeia revokeAllSessions → denylist → JwtStrategy (#823)', () => {
  let sessionService: SessionService;
  let strategy: JwtStrategy;
  let denylist: SessionDenylistService;
  /** Store em memória no lugar do Redis. */
  let store: Map<string, string>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        SessionDenylistService,
        { provide: PrismaService, useValue: mockPrisma },
        // Sem REDIS_URL/JWT_EXPIRY → defaults; o client é trocado abaixo.
        { provide: ConfigService, useValue: { get: jest.fn() } },
        // AuditService é @Optional() no SessionService — ausente de propósito.
      ],
    }).compile();

    jest.clearAllMocks();
    sessionService = module.get(SessionService);
    denylist = module.get(SessionDenylistService);

    // Redis substituído por um Map com a MESMA semântica de get/set EX.
    store = new Map();
    (denylist as any).client = {
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      disconnect: jest.fn(),
    };

    strategy = new JwtStrategy(
      { get: jest.fn().mockReturnValue('secret') } as any,
      denylist,
      // #1144: policy compartilhada; #341: sessão viva — esta cadeia testa a
      // denylist, não a ociosidade.
      new AccessSessionPolicy(
        denylist,
        { isSessionAliveAndTouch: jest.fn().mockResolvedValue(true) } as any,
      ),
    );

    mockPrisma.userSession.update.mockResolvedValue({});
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.securityEvent.create.mockResolvedValue({});
  });

  /** Fixture compartilhada: usuário-alvo com sessão viva e token emitido. */
  function sessionOf(userId: string, sessionId: string) {
    mockPrisma.userSession.findMany.mockResolvedValue([
      { id: sessionId, companyId: 'c1', refreshTokenId: 'rt-1' },
    ]);
    return {
      sub: userId,
      email: 'alvo@gdr.com.br',
      role: 'READER',
      companyId: 'c1',
      sessionId,
    };
  }

  it('ANTES da revogação o access token autentica; DEPOIS recebe 401', async () => {
    const payload = sessionOf('user-alvo', 'sess-alvo');

    // Antes: sessão viva, token passa.
    await expect(strategy.validate(payload)).resolves.toMatchObject({ id: 'user-alvo' });

    // Revogação crítica (mesma chamada feita por inativação #744, troca de
    // senha #743 e reset por admin #824).
    await sessionService.revokeAllSessions('user-alvo', 'SECURITY' as any);

    // Depois: o MESMO token (mesmo sessionId) morre na autenticação.
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(payload)).rejects.toThrow(
      'Sessão inválida ou expirada. Faça login novamente.',
    );
  });

  it('revogação NÃO crítica (LOGOUT) não denylista — token vive até expirar (comportamento documentado)', async () => {
    const payload = sessionOf('user-alvo', 'sess-logout');

    await sessionService.revokeAllSessions('user-alvo', 'LOGOUT' as any);

    // Refresh morreu (updateMany), mas o access não entra na denylist.
    await expect(strategy.validate(payload)).resolves.toMatchObject({ id: 'user-alvo' });
    expect(store.size).toBe(0);
  });

  it('múltiplas sessões do alvo são denylistadas individualmente', async () => {
    mockPrisma.userSession.findMany.mockResolvedValue([
      { id: 'sess-a', companyId: 'c1', refreshTokenId: 'rt-a' },
      { id: 'sess-b', companyId: 'c1', refreshTokenId: 'rt-b' },
    ]);

    await sessionService.revokeAllSessions('user-alvo', 'SECURITY' as any);

    for (const sessionId of ['sess-a', 'sess-b']) {
      await expect(
        strategy.validate({ sub: 'user-alvo', companyId: 'c1', sessionId }),
      ).rejects.toThrow(UnauthorizedException);
    }
  });

  it('sessão de OUTRO usuário não é afetada pela revogação do alvo', async () => {
    sessionOf('user-alvo', 'sess-alvo');
    await sessionService.revokeAllSessions('user-alvo', 'SECURITY' as any);

    await expect(
      strategy.validate({ sub: 'admin-1', companyId: 'c1', sessionId: 'sess-admin' }),
    ).resolves.toMatchObject({ id: 'admin-1' });
  });
});
