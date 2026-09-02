import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import {
  AuthService,
  PASSWORD_CHANGE_SCOPE,
  PASSWORD_CHANGE_TOKEN_TTL,
} from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MfaService } from '../iam/mfa.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { SessionService } from '../iam/session.service';
import { TenantStatusService } from '../iam/tenant-status.service';
import { CompanyGroupService } from '../iam/company-group.service';
import { AccessSessionPolicy } from '../iam/access-session-policy.service';
import { AuditService } from '../iam/audit.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  securityEvent: {
    create: jest.fn(),
  },
};

const mockJwt = {
  sign: jest.fn(),
  verify: jest.fn(),
};

const mockSessionService = {
  assertNotLocked: jest.fn(),
  recordLoginAttempt: jest.fn(),
  clearLockout: jest.fn(),
  createSession: jest.fn(),
  validateSessionForRefresh: jest.fn(),
  attachRefreshToSession: jest.fn(),
  revokeSessionByRefreshTokenId: jest.fn(),
  revokeAllSessions: jest.fn(),
};

// #1144: as validações de sessão do change-password são a MESMA policy da
// JwtStrategy — aqui a policy é real, com denylist/sessão mockados.
const mockDenylist = { isSessionDenylisted: jest.fn() };
const mockSessionsAlive = { isSessionAliveAndTouch: jest.fn() };

const mockMfaService = {
  isEnabled: jest.fn(),
  roleRequiresMfa: jest.fn(),
  verifyCode: jest.fn(),
  recordFailedVerify: jest.fn(),
};

const mockPasswordPolicy = {
  validateComplexity: jest.fn(),
  assertNotReused: jest.fn(),
  recordPasswordChange: jest.fn(),
  getMaxAgeDays: jest.fn(),
  isPasswordExpired: jest.fn(),
  getPolicy: jest.fn(),
};

// OPS WP1 (#908): default tenant liberado — cenários daqui não tocam nisso.
const mockTenantStatus = {
  getTenantRoot: jest.fn(),
  getLoginBlock: jest.fn(),
};

const mockUser = {
  id: 'user-1',
  email: 'admin@gdr.com.br',
  name: 'Admin',
  role: 'SUPER_ADMIN',
  companyId: 'company-1',
  passwordHash: '$2a$10$hashedpassword',
  isActive: true,
  mustChangePassword: false,
  passwordChangedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService — password policy no login e troca de senha (#345)', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: SessionService, useValue: mockSessionService },
        {
          provide: AccessSessionPolicy,
          useFactory: () => new AccessSessionPolicy(mockDenylist as any, mockSessionsAlive as any),
        },
        { provide: MfaService, useValue: mockMfaService },
        { provide: PasswordPolicyService, useValue: mockPasswordPolicy },
        { provide: TenantStatusService, useValue: mockTenantStatus },
        // #1119: empresa ativa/grupo econômico — default é "não tem grupo".
        {
          provide: CompanyGroupService,
          useValue: {
            empresasDoGrupo: jest.fn().mockResolvedValue([]),
            empresasDoUsuario: jest.fn().mockResolvedValue([]),
            podeAssumir: jest.fn().mockResolvedValue(false),
            raizDe: jest.fn(async (id: string) => id),
          },
        },
        { provide: AuditService, useValue: { persist: jest.fn() } },
      ],
    }).compile();

    service = module.get(AuthService);
    jest.clearAllMocks();
    jest.restoreAllMocks();

    mockSessionService.assertNotLocked.mockResolvedValue(undefined);
    mockSessionService.recordLoginAttempt.mockResolvedValue(undefined);
    mockSessionService.clearLockout.mockResolvedValue(undefined);
    mockSessionService.createSession.mockResolvedValue({ id: 'sess-1' });
    mockSessionService.revokeAllSessions.mockResolvedValue(1);
    mockDenylist.isSessionDenylisted.mockResolvedValue(false);
    mockSessionsAlive.isSessionAliveAndTouch.mockResolvedValue(true);
    mockTenantStatus.getLoginBlock.mockResolvedValue(null);
    mockMfaService.isEnabled.mockResolvedValue(false);
    mockMfaService.roleRequiresMfa.mockResolvedValue(false);
    mockPasswordPolicy.validateComplexity.mockReturnValue(undefined);
    mockPasswordPolicy.assertNotReused.mockResolvedValue(undefined);
    mockPasswordPolicy.recordPasswordChange.mockResolvedValue(undefined);
    mockPasswordPolicy.isPasswordExpired.mockResolvedValue(false);
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.securityEvent.create.mockResolvedValue({});
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
    mockJwt.sign.mockReturnValue('signed-token');
  });

  // ─── Login: senha vencida / mustChangePassword ─────────────────────────────

  describe('login com gate de senha', () => {
    it('senha vencida → passwordExpired: true + token restrito, SEM tokens finais', async () => {
      mockPasswordPolicy.isPasswordExpired.mockResolvedValue(true);

      const result = await service.login(mockUser);

      expect(result).toEqual({
        passwordChangeRequired: true,
        passwordExpired: true,
        mustChangePassword: false,
        passwordChangeToken: 'signed-token',
      });
      expect(result).not.toHaveProperty('accessToken');
      // Token restrito com o scope e TTL corretos.
      expect(mockJwt.sign).toHaveBeenCalledWith(
        { sub: 'user-1', scope: PASSWORD_CHANGE_SCOPE },
        { expiresIn: PASSWORD_CHANGE_TOKEN_TTL },
      );
      // Nenhuma sessão/refresh criado antes da troca.
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });

    it('mustChangePassword=true (primeiro acesso/reset por admin) → token restrito', async () => {
      const result = await service.login({ ...mockUser, mustChangePassword: true });

      expect(result).toMatchObject({
        passwordChangeRequired: true,
        mustChangePassword: true,
        passwordChangeToken: 'signed-token',
      });
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('senha OK e sem flag → login normal com tokens finais', async () => {
      const result = await service.login(mockUser);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).not.toHaveProperty('passwordChangeRequired');
    });

    it('consulta de rotação indisponível → login NÃO cai (best-effort)', async () => {
      mockPasswordPolicy.isPasswordExpired.mockRejectedValue(new Error('db down'));

      const result = await service.login(mockUser);
      expect(result).toHaveProperty('accessToken');
    });

    it('usuário COM MFA: gate roda DEPOIS do 2º fator (loginWithMfa)', async () => {
      // 1º passo: MFA habilitado → só o mfaPendingToken, sem vazar estado de senha.
      mockMfaService.isEnabled.mockResolvedValue(true);
      const step1 = await service.login({ ...mockUser, mustChangePassword: true });
      expect(step1).toHaveProperty('mfaRequired', true);
      expect(step1).not.toHaveProperty('passwordChangeRequired');

      // 2º passo: código válido + senha vencida → token restrito.
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: 'mfa_pending' });
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, mustChangePassword: true });
      mockMfaService.verifyCode.mockResolvedValue(true);

      const step2 = await service.loginWithMfa('pending-token', '123456');
      expect(step2).toMatchObject({
        passwordChangeRequired: true,
        mustChangePassword: true,
      });
      expect(step2).not.toHaveProperty('accessToken');
    });
  });

  // ─── Troca de senha ────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('com token restrito válido: troca, popula histórico e revoga as outras sessões', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: PASSWORD_CHANGE_SCOPE });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.changePassword({
        passwordChangeToken: 'restricted-token',
        newPassword: 'NovaSenha#2026x',
      });

      expect(result).toEqual({ success: true, message: 'Senha alterada com sucesso.' });
      // Política aplicada com contexto do usuário (nome/e-mail).
      expect(mockPasswordPolicy.validateComplexity).toHaveBeenCalledWith('NovaSenha#2026x', {
        email: mockUser.email,
        name: mockUser.name,
      });
      expect(mockPasswordPolicy.assertNotReused).toHaveBeenCalledWith('user-1', 'NovaSenha#2026x');
      // Update zera mustChangePassword e marca passwordChangedAt.
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            mustChangePassword: false,
            passwordChangedAt: expect.any(Date),
            passwordHash: expect.any(String),
          }),
        }),
      );
      // Histórico populado com o hash anterior + novo.
      expect(mockPasswordPolicy.recordPasswordChange).toHaveBeenCalledWith(
        'user-1',
        mockUser.passwordHash,
        expect.any(String),
      );
      // TODAS as sessões revogadas (sem exceção — modo restrito não tem sessão).
      expect(mockSessionService.revokeAllSessions).toHaveBeenCalledWith(
        'user-1',
        'SECURITY',
        undefined,
      );
      // SecurityEvent PASSWORD_CHANGED gravado.
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'PASSWORD_CHANGED', userId: 'user-1' }),
        }),
      );
    });

    it('ANTI-REPLAY: token restrito emitido ANTES da última troca → 401, nada persistido', async () => {
      // Cenário de ataque: token capturado; a vítima já trocou a senha
      // (passwordChangedAt recente). O token segue criptograficamente válido
      // pelos 10 min — mas iat < passwordChangedAt DEVE ser rejeitado, senão
      // o atacante troca a senha POR CIMA da que o usuário acabou de definir.
      const changedAt = new Date('2026-07-15T12:00:00.000Z');
      const issuedBefore = Math.floor(changedAt.getTime() / 1000) - 60; // 1 min antes
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        scope: PASSWORD_CHANGE_SCOPE,
        iat: issuedBefore,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordChangedAt: changedAt,
      });

      await expect(
        service.changePassword({
          passwordChangeToken: 'token-replay',
          newPassword: 'NovaSenha#2026x',
        }),
      ).rejects.toThrow('Token de troca de senha inválido ou expirado');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('token restrito emitido DEPOIS da última troca (uso legítimo) → troca normalmente', async () => {
      const changedAt = new Date('2026-07-15T12:00:00.000Z');
      const issuedAfter = Math.floor(changedAt.getTime() / 1000) + 60; // 1 min depois
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        scope: PASSWORD_CHANGE_SCOPE,
        iat: issuedAfter,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordChangedAt: changedAt,
      });

      const result = await service.changePassword({
        passwordChangeToken: 'token-legitimo',
        newPassword: 'NovaSenha#2026x',
      });
      expect(result).toEqual({ success: true, message: 'Senha alterada com sucesso.' });
    });

    it('autenticado normal: exige senha atual e preserva a sessão atual', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', sessionId: 'sess-atual' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.changePassword({
        authorizationHeader: 'Bearer access-token',
        currentPassword: 'SenhaAtual#123',
        newPassword: 'NovaSenha#2026x',
      });

      expect(result.success).toBe(true);
      // Revoga as OUTRAS sessões — a atual (sess-atual) sobrevive.
      expect(mockSessionService.revokeAllSessions).toHaveBeenCalledWith(
        'user-1',
        'SECURITY',
        'sess-atual',
      );
    });

    it('autenticado normal SEM senha atual → 401', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.changePassword({
          authorizationHeader: 'Bearer access-token',
          newPassword: 'NovaSenha#2026x',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('senha atual incorreta → 401 e nada é alterado', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.changePassword({
          authorizationHeader: 'Bearer access-token',
          currentPassword: 'errada',
          newPassword: 'NovaSenha#2026x',
        }),
      ).rejects.toThrow('Senha atual incorreta.');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('token restrito expirado/inválido → 401', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        service.changePassword({
          passwordChangeToken: 'expirado',
          newPassword: 'NovaSenha#2026x',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('token com scope errado (ex.: mfa_pending) no lugar do restrito → 401', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: 'mfa_pending' });

      await expect(
        service.changePassword({
          passwordChangeToken: 'scope-errado',
          newPassword: 'NovaSenha#2026x',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    // ── Regressão 02/09/2026: sessão por COOKIE httpOnly (#349) ──────────────
    // O controller passa `accessToken` (cookie gdr_access OU Bearer, via
    // extractAccessToken). Antes só o header era lido → 401 e senha intacta.
    it('COOKIE: accessToken (sem header) + senha atual correta → troca e preserva a sessão atual', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', sessionId: 'sess-cookie' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.changePassword({
        accessToken: 'tok-do-cookie',
        currentPassword: 'SenhaAtual#123',
        newPassword: 'NovaSenha#2026x',
      });

      expect(result.success).toBe(true);
      expect(mockJwt.verify).toHaveBeenCalledWith('tok-do-cookie', { algorithms: ['HS256'] });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ mustChangePassword: false }),
        }),
      );
      expect(mockPasswordPolicy.recordPasswordChange).toHaveBeenCalled();
      expect(mockSessionService.revokeAllSessions).toHaveBeenCalledWith(
        'user-1',
        'SECURITY',
        'sess-cookie',
      );
    });

    it('COOKIE: senha atual incorreta → 401 e nada é alterado', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', sessionId: 'sess-cookie' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.changePassword({
          accessToken: 'tok-do-cookie',
          currentPassword: 'errada',
          newPassword: 'NovaSenha#2026x',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('COOKIE: sem currentPassword → 401 (o cookie não dispensa a reconfirmação)', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', sessionId: 'sess-cookie' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.changePassword({ accessToken: 'tok-do-cookie', newPassword: 'NovaSenha#2026x' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('sem cookie, sem Bearer e sem passwordChangeToken → 401', async () => {
      await expect(
        service.changePassword({
          accessToken: null,
          currentPassword: 'SenhaAtual#123',
          newPassword: 'NovaSenha#2026x',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockJwt.verify).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('accessToken inválido/expirado (verify lança — inclui refresh assinado com outro segredo) → 401', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      await expect(
        service.changePassword({
          accessToken: 'tok-vencido-ou-refresh',
          currentPassword: 'SenhaAtual#123',
          newPassword: 'NovaSenha#2026x',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('token restrito (scope) entregue como accessToken → 401 (mesma regra da JwtStrategy)', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: PASSWORD_CHANGE_SCOPE });
      await expect(
        service.changePassword({
          accessToken: 'restrito-no-canal-errado',
          currentPassword: 'SenhaAtual#123',
          newPassword: 'NovaSenha#2026x',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('compatibilidade: chamador antigo com authorizationHeader cru continua funcionando', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', sessionId: 'sess-legado' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      const result = await service.changePassword({
        authorizationHeader: 'Bearer legado',
        currentPassword: 'SenhaAtual#123',
        newPassword: 'NovaSenha#2026x',
      });
      expect(result.success).toBe(true);
      expect(mockJwt.verify).toHaveBeenCalledWith('legado', { algorithms: ['HS256'] });
    });

    it('token restrito no header Authorization NÃO vale como access token → 401', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: PASSWORD_CHANGE_SCOPE });

      await expect(
        service.changePassword({
          authorizationHeader: 'Bearer token-restrito',
          currentPassword: 'x',
          newPassword: 'NovaSenha#2026x',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('sem nenhuma credencial → 401', async () => {
      await expect(
        service.changePassword({ newPassword: 'NovaSenha#2026x' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('nova senha fora da política → propaga o BadRequest da política, sem alterar nada', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: PASSWORD_CHANGE_SCOPE });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPasswordPolicy.validateComplexity.mockImplementation(() => {
        throw new Error('política violada');
      });

      await expect(
        service.changePassword({ passwordChangeToken: 'ok', newPassword: 'fraca' }),
      ).rejects.toThrow('política violada');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('reuso das últimas 5 → propaga o BadRequest do histórico, sem alterar nada', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: PASSWORD_CHANGE_SCOPE });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPasswordPolicy.assertNotReused.mockRejectedValue(new Error('senha reutilizada'));

      await expect(
        service.changePassword({ passwordChangeToken: 'ok', newPassword: 'NovaSenha#2026x' }),
      ).rejects.toThrow('senha reutilizada');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('usuário inativo → 401', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: PASSWORD_CHANGE_SCOPE });
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });

      await expect(
        service.changePassword({ passwordChangeToken: 'ok', newPassword: 'NovaSenha#2026x' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('fluxo completo: senha vencida → token restrito → troca ok → sessões revogadas', async () => {
      // 1. Login com senha vencida devolve o token restrito.
      mockPasswordPolicy.isPasswordExpired.mockResolvedValue(true);
      const loginResult: any = await service.login(mockUser);
      expect(loginResult.passwordExpired).toBe(true);
      expect(loginResult.passwordChangeToken).toBeDefined();

      // 2. Troca com o token restrito.
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: PASSWORD_CHANGE_SCOPE });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      const change = await service.changePassword({
        passwordChangeToken: loginResult.passwordChangeToken,
        newPassword: 'NovaSenha#2026x',
      });
      expect(change.success).toBe(true);

      // 3. Sessões revogadas + evento de segurança.
      expect(mockSessionService.revokeAllSessions).toHaveBeenCalled();
      expect(mockPrisma.securityEvent.create).toHaveBeenCalled();
    });
  });
  // ─── #1144: access token do change-password passa pelas validações da JwtStrategy ─

  describe('changePassword — validações de sessão compartilhadas com a JwtStrategy (#1144)', () => {
    const cookie = { accessToken: 'access-cookie', currentPassword: 'SenhaAtual#123', newPassword: 'NovaSenha#2026x' };

    beforeEach(() => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', sessionId: 'sess-atual' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    });

    it('sessão revogada/denylistada (#823) → 401 e nada persistido', async () => {
      mockDenylist.isSessionDenylisted.mockResolvedValue(true);

      await expect(service.changePassword(cookie)).rejects.toThrow(
        'Sessão inválida ou expirada. Faça login novamente.',
      );
      expect(mockDenylist.isSessionDenylisted).toHaveBeenCalledWith('sess-atual');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('sessão encerrada por inatividade (#341) → 401 e nada persistido', async () => {
      mockSessionsAlive.isSessionAliveAndTouch.mockResolvedValue(false);

      await expect(service.changePassword(cookie)).rejects.toThrow(
        'Sessão encerrada por inatividade. Faça login novamente.',
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('sessão viva → troca; a requisição conta como atividade (touch) e o verify fixa HS256', async () => {
      const result = await service.changePassword(cookie);

      expect(result.success).toBe(true);
      expect(mockSessionsAlive.isSessionAliveAndTouch).toHaveBeenCalledWith('sess-atual', false);
      expect(mockJwt.verify).toHaveBeenCalledWith('access-cookie', { algorithms: ['HS256'] });
    });

    it('token legado SEM sessionId (transição #342) → não consulta sessão e segue valendo', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1' });

      const result = await service.changePassword(cookie);

      expect(result.success).toBe(true);
      expect(mockDenylist.isSessionDenylisted).not.toHaveBeenCalled();
      expect(mockSessionsAlive.isSessionAliveAndTouch).not.toHaveBeenCalled();
    });

    it('modo FORCED (token restrito) NÃO passa pela policy de sessão — é outra credencial', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        scope: PASSWORD_CHANGE_SCOPE,
        iat: Math.floor(Date.now() / 1000) + 5,
      });
      mockDenylist.isSessionDenylisted.mockResolvedValue(true); // seria 401 no canal normal

      const result = await service.changePassword({
        passwordChangeToken: 'restrito',
        newPassword: 'NovaSenha#2026x',
      });

      expect(result.success).toBe(true);
      expect(mockDenylist.isSessionDenylisted).not.toHaveBeenCalled();
      expect(mockJwt.verify).toHaveBeenCalledWith('restrito', { algorithms: ['HS256'] });
    });
  });
});
