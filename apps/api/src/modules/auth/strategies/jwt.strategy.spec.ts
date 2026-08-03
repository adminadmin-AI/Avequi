import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { MFA_PENDING_SCOPE, PASSWORD_CHANGE_SCOPE } from '../auth.service';

const mockDenylist = {
  isSessionDenylisted: jest.fn(),
};
const mockSessions = { isSessionAliveAndTouch: jest.fn() };

describe('JwtStrategy — impersonation (OPS WP6 #913)', () => {
  const mockDeny = { isSessionDenylisted: jest.fn() };
  const mockSess = { isSessionAliveAndTouch: jest.fn().mockResolvedValue(true) };
  const { JwtStrategy: JS } = require('./jwt.strategy');
  const strategy = new JS({ get: jest.fn().mockReturnValue('secret') }, mockDeny, mockSess);
  const payload = {
    sub: 'alvo', email: 'a@b.c', role: 'MANAGER', companyId: 'c1',
    scope: 'impersonation', iid: 'iid-1', impersonatorId: 'op-1', readOnly: true,
  };

  it('aceita como access token do ALVO com contexto de impersonation', async () => {
    mockDeny.isSessionDenylisted.mockResolvedValue(false);
    const user = await strategy.validate(payload);
    expect(user).toMatchObject({
      id: 'alvo', companyId: 'c1',
      impersonation: { iid: 'iid-1', impersonatorId: 'op-1', readOnly: true },
    });
    // sem sessionId: nem denylist de sessão nem idle-touch do usuário alvo
    expect(mockSess.isSessionAliveAndTouch).not.toHaveBeenCalled();
  });

  it('iid na denylist (encerrada pelo operador) → 401', async () => {
    mockDeny.isSessionDenylisted.mockResolvedValue(true);
    await expect(strategy.validate(payload)).rejects.toThrow(/suporte encerrada/);
  });
});

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    const mockConfig = {
      get: jest.fn().mockReturnValue('test-secret-key-for-jwt-at-least-32-chars'),
    };
    jest.clearAllMocks();
    mockDenylist.isSessionDenylisted.mockResolvedValue(false);
    // #341: a strategy agora também mede ociosidade da sessão; nos testes de
    // denylist a sessão está sempre viva (o comportamento de inatividade tem
    // spec próprio em session-idle.spec.ts).
    mockSessions.isSessionAliveAndTouch.mockResolvedValue(true);
    strategy = new JwtStrategy(mockConfig as any, mockDenylist as any, mockSessions as any);
  });

  it('should extract user from valid payload', async () => {
    const payload = {
      sub: 'user-1',
      email: 'admin@gdr.com.br',
      role: 'SUPER_ADMIN',
      companyId: 'company-1',
    };

    const result = await strategy.validate(payload);

    expect(result).toEqual({
      id: 'user-1',
      email: 'admin@gdr.com.br',
      role: 'SUPER_ADMIN',
      companyId: 'company-1',
      sessionId: undefined,
    });
  });

  it('should map sub to id', async () => {
    const result = await strategy.validate({ sub: 'abc-123' });

    expect(result.id).toBe('abc-123');
  });

  it('should return undefined fields when payload is incomplete', async () => {
    const result = await strategy.validate({ sub: 'user-1' });

    expect(result.id).toBe('user-1');
    expect(result.companyId).toBeUndefined();
    expect(result.role).toBeUndefined();
    expect(result.email).toBeUndefined();
  });

  it('should REJECT the mfaPendingToken as access token (escopo restrito, #344)', async () => {
    await expect(
      strategy.validate({ sub: 'user-1', scope: MFA_PENDING_SCOPE }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should REJECT the passwordChangeToken as access token (escopo restrito, #345)', async () => {
    await expect(
      strategy.validate({ sub: 'user-1', scope: PASSWORD_CHANGE_SCOPE }),
    ).rejects.toThrow(UnauthorizedException);
  });

  // ─── #823: denylist de sessão na validação do access token ────────────────

  describe('denylist de sessão (#823)', () => {
    const payload = {
      sub: 'user-1',
      email: 'a@b.c',
      role: 'READER',
      companyId: 'company-1',
      sessionId: 'sess-1',
    };

    it('sessão NÃO denylistada → autentica; consulta feita UMA única vez', async () => {
      const result = await strategy.validate(payload);

      expect(result.id).toBe('user-1');
      expect(result.sessionId).toBe('sess-1');
      expect(mockDenylist.isSessionDenylisted).toHaveBeenCalledTimes(1);
      expect(mockDenylist.isSessionDenylisted).toHaveBeenCalledWith('sess-1');
    });

    it('sessão denylistada → 401 UnauthorizedException com mensagem GENÉRICA (não revela o motivo)', async () => {
      mockDenylist.isSessionDenylisted.mockResolvedValue(true);

      const rejection = expect(strategy.validate(payload)).rejects;
      await rejection.toThrow(UnauthorizedException);
      await expect(strategy.validate(payload)).rejects.toThrow(
        'Sessão inválida ou expirada. Faça login novamente.',
      );
    });

    it('token legado SEM sessionId (transição M4, #342) → não consulta e segue valendo', async () => {
      const result = await strategy.validate({ sub: 'user-1', email: 'a@b.c' });

      expect(result.id).toBe('user-1');
      expect(mockDenylist.isSessionDenylisted).not.toHaveBeenCalled();
    });

    it('token restrito é rejeitado ANTES da denylist (nem consulta)', async () => {
      await expect(
        strategy.validate({ sub: 'user-1', scope: PASSWORD_CHANGE_SCOPE, sessionId: 'sess-1' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockDenylist.isSessionDenylisted).not.toHaveBeenCalled();
    });

    it('fail-open do serviço (Redis fora → false, contrato testado no spec dele) mantém o token até expirar', async () => {
      mockDenylist.isSessionDenylisted.mockResolvedValue(false);

      const result = await strategy.validate(payload);

      expect(result.id).toBe('user-1');
    });
  });
});
