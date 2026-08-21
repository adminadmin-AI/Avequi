import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GroupsService } from './groups.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { SessionService } from '../iam/session.service';

/**
 * #1119 — grupo econômico no control plane (escrita).
 *
 * O foco dos testes é a DESASSOCIAÇÃO, que é onde mora o risco: sair do grupo
 * tem de derrubar tudo que o grupo autorizava, dos dois lados (quem entrava
 * na empresa que saiu, e quem saía dela para as demais). Vínculo órfão de um
 * grupo que não existe mais é acesso cross-tenant sem nada que o justifique.
 */

const GRUPO = 'grupo-1';
const GDR = 'gdr';
const CRD = 'crd';

const mockPrisma = {
  companyGroup: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  company: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  userRoleAssignment: { deleteMany: jest.fn() },
  userSession: { findMany: jest.fn() },
};

const mockAudit = { persist: jest.fn() };
const mockSessions = { revokeSessionsInCompany: jest.fn() };

const ctx = {
  userId: 'operador-1',
  actorCompanyId: 'avecchi',
  ipAddress: '10.0.0.1',
  userAgent: 'Chrome',
};

describe('GroupsService (#1119)', () => {
  let service: GroupsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: SessionService, useValue: mockSessions },
      ],
    }).compile();

    service = module.get(GroupsService);
    jest.clearAllMocks();
    mockSessions.revokeSessionsInCompany.mockResolvedValue(0);
    mockPrisma.userRoleAssignment.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.userSession.findMany.mockResolvedValue([]);
  });

  describe('addCompany', () => {
    beforeEach(() => {
      mockPrisma.companyGroup.findUnique.mockResolvedValue({ id: GRUPO, name: 'Grupo GDR' });
      mockPrisma.company.update.mockResolvedValue({ id: CRD, name: 'CRD' });
    });

    it('associa um tenant raiz e audita NO TENANT (não no contexto do operador)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({
        id: CRD,
        name: 'CRD',
        parentId: null,
        groupId: null,
      });

      await service.addCompany(GRUPO, { companyId: CRD }, ctx);

      // O admin do cliente precisa achar, na trilha DELE, o dia em que a
      // empresa entrou num grupo.
      expect(mockAudit.persist).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: CRD, entity: 'Company' }),
      );
    });

    it('filial NÃO entra em grupo — ela acompanha a matriz', async () => {
      // Deixar a filial entrar sozinha criaria dois grupos para o mesmo tenant.
      mockPrisma.company.findUnique.mockResolvedValue({
        id: 'gdr-guarapuava',
        name: 'GDR Guarapuava',
        parentId: GDR,
        groupId: null,
      });

      await expect(
        service.addCompany(GRUPO, { companyId: 'gdr-guarapuava' }, ctx),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.company.update).not.toHaveBeenCalled();
    });

    it('empresa já em OUTRO grupo → conflito explícito, nunca troca em silêncio', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({
        id: CRD,
        name: 'CRD',
        parentId: null,
        groupId: 'outro-grupo',
      });

      await expect(service.addCompany(GRUPO, { companyId: CRD }, ctx)).rejects.toThrow(
        ConflictException,
      );
    });

    it('empresa inexistente → 404', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(null);

      await expect(service.addCompany(GRUPO, { companyId: 'nada' }, ctx)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeCompany', () => {
    beforeEach(() => {
      mockPrisma.company.findUnique.mockResolvedValue({
        id: CRD,
        name: 'CRD',
        groupId: GRUPO,
      });
      mockPrisma.company.findMany.mockResolvedValue([{ id: GDR }]); // remanescentes
      mockPrisma.company.update.mockResolvedValue({ id: CRD, name: 'CRD' });
    });

    it('limpa os vínculos cruzados DOS DOIS LADOS', async () => {
      mockPrisma.userRoleAssignment.deleteMany.mockResolvedValue({ count: 2 });

      await service.removeCompany(GRUPO, CRD, ctx);

      // Visitantes na empresa que saiu…
      expect(mockPrisma.userRoleAssignment.deleteMany).toHaveBeenCalledWith({
        where: { companyId: CRD, user: { companyId: { not: CRD } } },
      });
      // …e gente da empresa que saiu nas que ficaram.
      expect(mockPrisma.userRoleAssignment.deleteMany).toHaveBeenCalledWith({
        where: { companyId: { in: [GDR] }, user: { companyId: CRD } },
      });
    });

    it('NÃO toca no vínculo de quem é da casa — ele não depende de grupo', async () => {
      await service.removeCompany(GRUPO, CRD, ctx);

      const filtros = mockPrisma.userRoleAssignment.deleteMany.mock.calls.map(
        (c) => c[0].where,
      );
      // Toda remoção carrega uma condição sobre o usuário; nenhuma apaga
      // "todos os vínculos da empresa".
      for (const where of filtros) {
        expect(where.user).toBeDefined();
      }
    });

    it('derruba as sessões de visitantes na empresa que saiu', async () => {
      await service.removeCompany(GRUPO, CRD, ctx);

      expect(mockSessions.revokeSessionsInCompany).toHaveBeenCalledWith(CRD, {
        exceptUserIdsOfCompany: true,
      });
    });

    it('derruba também quem saiu da CRD e estava trabalhando na GDR', async () => {
      mockPrisma.userSession.findMany.mockResolvedValue([{ userId: 'u-crd' }]);

      await service.removeCompany(GRUPO, CRD, ctx);

      expect(mockSessions.revokeSessionsInCompany).toHaveBeenCalledWith(GDR, {
        userId: 'u-crd',
      });
    });

    it('audita ANTES dos efeitos colaterais', async () => {
      const ordem: string[] = [];
      mockAudit.persist.mockImplementation(async () => {
        ordem.push('audit');
      });
      mockPrisma.userRoleAssignment.deleteMany.mockImplementation(async () => {
        ordem.push('limpeza');
        return { count: 0 };
      });

      await service.removeCompany(GRUPO, CRD, ctx);

      // Limpeza que falha no meio deixa a decisão registrada mesmo assim.
      expect(ordem[0]).toBe('audit');
    });

    it('empresa que não pertence ao grupo → 404', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({
        id: CRD,
        name: 'CRD',
        groupId: 'outro-grupo',
      });

      await expect(service.removeCompany(GRUPO, CRD, ctx)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.userRoleAssignment.deleteMany).not.toHaveBeenCalled();
    });
  });
});
