import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSessionPolicy } from '../iam/access-session-policy.service';
import { AuditService } from '../iam/audit.service';
import { CompanyGroupService } from '../iam/company-group.service';
import { MfaService } from '../iam/mfa.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { SessionService } from '../iam/session.service';
import { TenantStatusService } from '../iam/tenant-status.service';

/**
 * #1119 — EMPRESA ATIVA DA SESSÃO (grupo econômico GDR ↔ CRD).
 *
 * O que estes testes protegem, em ordem de gravidade:
 *
 *  1. **Trabalhar na empresa errada.** O contexto ativo define o CNPJ
 *     emitente da NF-e. Nenhum caminho pode trocar a empresa por baixo de
 *     quem está trabalhando — nem o refresh, nem a perda de acesso. Por isso
 *     o refresh falha com 401 em vez de rebaixar para a empresa de cadastro.
 *  2. **Atravessar o grupo pela porta dos fundos.** A autorização é sempre
 *     resolvida a partir da empresa de CADASTRO (`homeCompanyId`), nunca da
 *     ativa — senão A→B→C encadearia grupos que ninguém declarou junto.
 *  3. **Sobreviver à revogação.** Perder o vínculo (ou o grupo) tem de valer
 *     no próximo refresh, não só quando o token expirar sozinho.
 */

const GDR = 'gdr-company';
const CRD = 'crd-company';
const FORA = 'empresa-de-outro-cliente';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  company: { findMany: jest.fn() },
  refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
};

const mockJwt = { sign: jest.fn(), verify: jest.fn() };

const mockSessionService = {
  assertNotLocked: jest.fn(),
  recordLoginAttempt: jest.fn(),
  clearLockout: jest.fn(),
  createSession: jest.fn(),
  validateSessionForRefresh: jest.fn(),
  attachRefreshToSession: jest.fn(),
  revokeSession: jest.fn(),
  revokeAllSessions: jest.fn(),
};

const mockCompanyGroup = {
  empresasDoGrupo: jest.fn(),
  empresasDoUsuario: jest.fn(),
  podeAssumir: jest.fn(),
  raizDe: jest.fn(async (id: string) => id),
};

const mockTenantStatus = { getLoginBlock: jest.fn() };
const mockAudit = { persist: jest.fn() };

describe('#1119 — empresa ativa da sessão', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: SessionService, useValue: mockSessionService },
        // #1144: policy de sessão do change-password — cenários daqui não tocam nisso.
        { provide: AccessSessionPolicy, useValue: { assertUsable: jest.fn() } },
        { provide: MfaService, useValue: {} },
        { provide: PasswordPolicyService, useValue: { isPasswordExpired: jest.fn() } },
        { provide: TenantStatusService, useValue: mockTenantStatus },
        { provide: CompanyGroupService, useValue: mockCompanyGroup },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(AuthService);
    jest.clearAllMocks();

    mockTenantStatus.getLoginBlock.mockResolvedValue(null);
    mockCompanyGroup.podeAssumir.mockResolvedValue(true);
    mockJwt.sign.mockReturnValue('token');
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-novo' });
    mockSessionService.createSession.mockResolvedValue({ id: 'sess-nova' });
  });

  // ─── switchCompany ────────────────────────────────────────────────────────

  describe('switchCompany', () => {
    const ator = { id: 'u1', companyId: GDR, homeCompanyId: GDR, sessionId: 'sess-antiga' };

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'claudio@gdr.com.br',
        role: 'SUPER_ADMIN',
        companyId: GDR,
        isActive: true,
      });
    });

    it('emite token com a empresa DESTINO ativa e o cadastro preservado', async () => {
      await service.switchCompany(ator, CRD);

      // O payload assinado é o contrato com o resto da API: companyId escopa
      // as consultas, homeCompanyId ancora a próxima autorização de troca.
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: CRD, homeCompanyId: GDR }),
        expect.anything(),
      );
    });

    it('a sessão nova nasce na empresa ATIVA (é o que a revogação por empresa alcança)', async () => {
      await service.switchCompany(ator, CRD);

      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        { id: 'u1', companyId: CRD },
        expect.anything(),
        'rt-novo',
      );
    });

    it('a autorização é resolvida pela empresa de CADASTRO, nunca pela ativa', async () => {
      // Já trabalhando na CRD, tentando ir para uma terceira. Se a pergunta
      // fosse feita a partir da CRD, um encadeamento GDR→CRD→X atravessaria
      // grupos que ninguém declarou juntos.
      await service
        .switchCompany({ ...ator, companyId: CRD, homeCompanyId: GDR }, FORA)
        .catch(() => undefined);

      expect(mockCompanyGroup.podeAssumir).toHaveBeenCalledWith('u1', GDR, FORA);
    });

    it('sem vínculo/fora do grupo → 403 genérico (não é oráculo de empresas)', async () => {
      mockCompanyGroup.podeAssumir.mockResolvedValue(false);

      await expect(service.switchCompany(ator, FORA)).rejects.toThrow(ForbiddenException);
      // Mensagem igual para "não existe", "outro grupo" e "sem vínculo".
      await expect(service.switchCompany(ator, FORA)).rejects.toThrow(/indisponível/i);
    });

    it('tenant destino suspenso → recusado (o grupo não contorna a suspensão)', async () => {
      mockTenantStatus.getLoginBlock.mockResolvedValue({
        message: 'Conta suspensa — regularize para voltar a acessar.',
      });

      await expect(service.switchCompany(ator, CRD)).rejects.toThrow(ForbiddenException);
      expect(mockJwt.sign).not.toHaveBeenCalled();
    });

    it('trocar para a empresa em que já está → 400 (não gera sessão à toa)', async () => {
      await expect(service.switchCompany(ator, GDR)).rejects.toThrow(BadRequestException);
    });

    it('audita nas DUAS empresas — origem e destino', async () => {
      await service.switchCompany(ator, CRD);

      // Sem a trilha no destino, o admin da CRD veria ações de alguém que,
      // para a auditoria dele, nunca entrou.
      const empresasAuditadas = mockAudit.persist.mock.calls.map((c) => c[0].companyId);
      expect(empresasAuditadas).toEqual(expect.arrayContaining([GDR, CRD]));
    });

    it('usuário desativado no meio do caminho → 401', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: false });

      await expect(service.switchCompany(ator, CRD)).rejects.toThrow(UnauthorizedException);
    });

    it('falha ao encerrar a sessão anterior não derruba a troca', async () => {
      // Emitir primeiro e revogar depois é deliberado: no pior caso sobra uma
      // sessão, nunca falta a nova.
      mockSessionService.revokeSession.mockRejectedValue(new Error('redis fora'));

      await expect(service.switchCompany(ator, CRD)).resolves.toBeDefined();
    });
  });

  // ─── refresh ──────────────────────────────────────────────────────────────

  describe('refresh com empresa ativa', () => {
    beforeEach(() => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        isActive: true,
        mustChangePassword: false,
        companyId: GDR,
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockSessionService.validateSessionForRefresh.mockResolvedValue({
        active: true,
        session: { id: 'sess-1' },
      });
    });

    const payloadNaCrd = {
      sub: 'u1',
      email: 'claudio@gdr.com.br',
      role: 'SUPER_ADMIN',
      companyId: CRD,
      homeCompanyId: GDR,
      iat: 1,
      exp: 2,
    };

    it('a empresa ativa SOBREVIVE à rotação — quem está na CRD continua na CRD', async () => {
      // A regressão mais cara desta feature: voltar para a empresa de cadastro
      // no primeiro refresh silencioso significa lançar na empresa errada sem
      // ninguém perceber.
      mockJwt.verify.mockReturnValue(payloadNaCrd);

      await service.refresh('refresh-antigo');

      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: CRD, homeCompanyId: GDR }),
      );
    });

    it('valida a suspensão da empresa ATIVA, não a de cadastro', async () => {
      mockJwt.verify.mockReturnValue(payloadNaCrd);

      await service.refresh('refresh-antigo');

      // Checar a GDR aqui deixaria um visitante renovando token numa CRD
      // suspensa indefinidamente.
      expect(mockTenantStatus.getLoginBlock).toHaveBeenCalledWith(CRD);
    });

    it('vínculo revogado → 401 explícito, NUNCA rebaixa para a empresa de casa', async () => {
      mockJwt.verify.mockReturnValue(payloadNaCrd);
      mockCompanyGroup.podeAssumir.mockResolvedValue(false);

      await expect(service.refresh('refresh-antigo')).rejects.toThrow(UnauthorizedException);
      await expect(service.refresh('refresh-antigo')).rejects.toThrow(/acesso a esta empresa/i);
      expect(mockJwt.sign).not.toHaveBeenCalled();
    });

    it('sessão na própria empresa não paga a consulta de vínculo', async () => {
      mockJwt.verify.mockReturnValue({ ...payloadNaCrd, companyId: GDR });

      await service.refresh('refresh-antigo');

      // O caso de 100% dos tenants sem grupo: nenhum custo novo no caminho
      // mais quente da API.
      expect(mockCompanyGroup.podeAssumir).not.toHaveBeenCalled();
    });

    it('token legado sem homeCompanyId continua válido (transição)', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'u1',
        email: 'admin@gdr.com.br',
        role: 'SUPER_ADMIN',
        companyId: GDR,
        iat: 1,
        exp: 2,
      });

      await expect(service.refresh('refresh-antigo')).resolves.toBeDefined();
    });
  });

  // ─── listCompaniesForUser ─────────────────────────────────────────────────

  describe('listCompaniesForUser', () => {
    it('marca a empresa de cadastro e devolve o grupo em ordem', async () => {
      mockCompanyGroup.empresasDoUsuario.mockResolvedValue([GDR, CRD]);
      mockPrisma.company.findMany.mockResolvedValue([
        { id: CRD, name: 'CRD', razaoSocial: null, cnpj: '3', parentId: null },
        { id: GDR, name: 'GDR', razaoSocial: null, cnpj: '4', parentId: null },
      ]);

      const lista = await service.listCompaniesForUser('u1', GDR);

      expect(lista).toHaveLength(2);
      expect(lista.find((e) => e.id === GDR)?.isHome).toBe(true);
      expect(lista.find((e) => e.id === CRD)?.isHome).toBe(false);
    });

    it('consulta SÓ os ids autorizados — nunca uma listagem aberta de empresas', async () => {
      mockCompanyGroup.empresasDoUsuario.mockResolvedValue([GDR]);
      mockPrisma.company.findMany.mockResolvedValue([]);

      await service.listCompaniesForUser('u1', GDR);

      expect(mockPrisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [GDR] } } }),
      );
    });
  });
});
