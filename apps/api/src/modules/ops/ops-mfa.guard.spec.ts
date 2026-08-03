import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MfaService } from '../iam/mfa.service';
import { OpsMfaGuard } from './ops-mfa.guard';

/**
 * OPS WP1 (#908) — MFA DURO nas rotas /ops: sem MFA ativo, 403; erro de
 * infraestrutura na consulta também nega (fail-closed).
 */

const mockMfaService = { isEnabled: jest.fn() };

function contextWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('OpsMfaGuard (OPS WP1 #908)', () => {
  let guard: OpsMfaGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OpsMfaGuard, { provide: MfaService, useValue: mockMfaService }],
    }).compile();
    guard = module.get(OpsMfaGuard);
    jest.clearAllMocks();
  });

  it('usuário com MFA ativo → libera', async () => {
    mockMfaService.isEnabled.mockResolvedValue(true);
    await expect(guard.canActivate(contextWithUser({ id: 'u1' }))).resolves.toBe(
      true,
    );
    expect(mockMfaService.isEnabled).toHaveBeenCalledWith('u1');
  });

  it('usuário SEM MFA → 403 com instrução de habilitar', async () => {
    mockMfaService.isEnabled.mockResolvedValue(false);
    await expect(
      guard.canActivate(contextWithUser({ id: 'u1' })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      guard.canActivate(contextWithUser({ id: 'u1' })),
    ).rejects.toThrow(/MFA/);
  });

  it('sem identidade na request → 403 (defesa contra reordenação de guards)', async () => {
    await expect(guard.canActivate(contextWithUser(undefined))).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockMfaService.isEnabled).not.toHaveBeenCalled();
  });

  it('erro na consulta de MFA → 403 (fail-closed, nunca libera em incidente)', async () => {
    mockMfaService.isEnabled.mockRejectedValue(new Error('db down'));
    await expect(
      guard.canActivate(contextWithUser({ id: 'u1' })),
    ).rejects.toThrow(ForbiddenException);
  });
});
