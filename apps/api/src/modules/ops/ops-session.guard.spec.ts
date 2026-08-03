import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { OPS_SESSION_MAX_AGE_MS, OpsSessionGuard } from './ops-session.guard';

/**
 * OPS WP7 (#914) — sessão CURTA no control plane: idade absoluta acima de
 * OPS_SESSION_MAX_AGE_MINUTES fecha as rotas /ops (o app não é afetado).
 * Fail-closed em todas as saídas: sem sessionId, sessão revogada/inexistente
 * e erro de infra negam.
 */

const mockPrisma = { userSession: { findUnique: jest.fn() } };

function contextWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const user = { id: 'u1', sessionId: 's1' };

describe('OpsSessionGuard (OPS WP7 #914)', () => {
  let guard: OpsSessionGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OpsSessionGuard, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    guard = module.get(OpsSessionGuard);
    jest.clearAllMocks();
  });

  it('default do teto é 8h (env fora da faixa/inexistente cai no default)', () => {
    expect(OPS_SESSION_MAX_AGE_MS).toBe(480 * 60_000);
  });

  it('sessão recente e viva → libera', async () => {
    mockPrisma.userSession.findUnique.mockResolvedValue({
      createdAt: new Date(Date.now() - 60_000),
      revokedAt: null,
    });
    await expect(guard.canActivate(contextWithUser(user))).resolves.toBe(true);
    expect(mockPrisma.userSession.findUnique).toHaveBeenCalledWith({
      where: { id: 's1' },
      select: { createdAt: true, revokedAt: true },
    });
  });

  it('sessão mais velha que o teto → 403 mandando refazer login', async () => {
    mockPrisma.userSession.findUnique.mockResolvedValue({
      createdAt: new Date(Date.now() - OPS_SESSION_MAX_AGE_MS - 1000),
      revokedAt: null,
    });
    await expect(guard.canActivate(contextWithUser(user))).rejects.toThrow(
      /muito antiga/,
    );
  });

  it('token sem sessionId (legado pré-#342) → 403 (não prova idade)', async () => {
    await expect(
      guard.canActivate(contextWithUser({ id: 'u1' })),
    ).rejects.toThrow(ForbiddenException);
    expect(mockPrisma.userSession.findUnique).not.toHaveBeenCalled();
  });

  it('sessão inexistente → 403', async () => {
    mockPrisma.userSession.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(contextWithUser(user))).rejects.toThrow(
      /Sessão inválida/,
    );
  });

  it('sessão revogada → 403 mesmo que recente', async () => {
    mockPrisma.userSession.findUnique.mockResolvedValue({
      createdAt: new Date(),
      revokedAt: new Date(),
    });
    await expect(guard.canActivate(contextWithUser(user))).rejects.toThrow(
      /Sessão inválida/,
    );
  });

  it('erro de infra na consulta → 403 (fail-closed)', async () => {
    mockPrisma.userSession.findUnique.mockRejectedValue(new Error('db down'));
    await expect(guard.canActivate(contextWithUser(user))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
