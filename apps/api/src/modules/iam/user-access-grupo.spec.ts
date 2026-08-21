import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserAccessService } from './user-access.service';
import { AuditService } from './audit.service';
import { CompanyGroupService } from './company-group.service';
import { LastAdminInvariantService } from './last-admin-invariant.service';
import { LegacyRoleMirrorService } from './legacy-role-mirror.service';
import { PermissionService } from './permission.service';
import { SessionService } from './session.service';
import { TenantScopeService } from './tenant-scope.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * #1119 — concessão de perfil em OUTRA empresa do grupo econômico.
 *
 * Este é o ponto onde o admin do cliente age sozinho, sem passar pela
 * operadora — então é onde a escalada de privilégio seria possível se as
 * travas não estivessem certas. Duas, independentes:
 *
 *  1. a empresa destino tem de estar no grupo declarado pela operadora;
 *  2. o ator precisa de `iam.roles.assign` NA EMPRESA DESTINO.
 *
 * A trava 2 é a que impede o ataque óbvio: virar grupo com outro cliente não
 * pode transformar o admin da GDR em admin da CRD.
 */

const GDR = 'gdr';
const CRD = 'crd';
const FORA = 'empresa-de-outro-cliente';

const ATOR = { id: 'admin-gdr', companyId: GDR };
const ALVO = {
  id: 'user-2',
  name: 'Emanuele',
  email: 'ema@gdr.com.br',
  role: 'FINANCIAL',
  companyId: GDR,
};

const mockCompanyGroup = {
  empresasDoGrupo: jest.fn(),
  empresasDoUsuario: jest.fn(),
  podeAssumir: jest.fn(),
  raizDe: jest.fn(async (id: string) => id),
};

const mockPermissionService = {
  invalidateRole: jest.fn(),
  invalidateUser: jest.fn(),
  hasPermission: jest.fn(),
};

const mockSessions = { revokeSessionsInCompany: jest.fn().mockResolvedValue(0) };

function buildPrisma() {
  const prisma: any = {
    user: { findFirst: jest.fn().mockResolvedValue(ALVO) },
    role: {
      findFirst: jest.fn().mockResolvedValue({ id: 'r1', code: 'FINANCEIRO', name: 'Financeiro' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    branch: { findFirst: jest.fn() },
    userRoleAssignment: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'ura-1' }),
      delete: jest.fn(),
    },
    permissionChangeLog: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  return prisma;
}

describe('UserAccessService — grupo econômico (#1119)', () => {
  let service: UserAccessService;
  let prisma: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserAccessService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionService, useValue: mockPermissionService },
        { provide: AuditService, useValue: { log: jest.fn(), logWithDiff: jest.fn() } },
        {
          provide: LastAdminInvariantService,
          useValue: {
            temVinculoAdminPerpetuo: jest.fn().mockResolvedValue(false),
            ehAdminGlobalEfetivo: jest.fn().mockResolvedValue(false),
            executarProtegido: jest.fn(async (_c: string, op: any) => op(prisma, {})),
          },
        },
        {
          provide: LegacyRoleMirrorService,
          useValue: {
            sincronizarNaTransacao: jest.fn().mockResolvedValue({
              status: 'FROZEN',
              perfis: [],
              enumAnterior: 'FINANCIAL',
              enumResultante: 'FINANCIAL',
            }),
            revogarSessoesSeMudou: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: TenantScopeService,
          useValue: {
            resolverEscopo: jest.fn(async (_u: string, c: string) => ({
              companyIds: [c],
              ampliado: false,
            })),
          },
        },
        { provide: CompanyGroupService, useValue: mockCompanyGroup },
        { provide: SessionService, useValue: mockSessions },
      ],
    }).compile();

    service = module.get(UserAccessService);

    mockCompanyGroup.empresasDoGrupo.mockResolvedValue([GDR, CRD]);
    mockPermissionService.hasPermission.mockResolvedValue(true);
  });

  describe('assignRole com empresaDoVinculo do grupo', () => {
    it('grava o vínculo na empresa DESTINO, não na do usuário', async () => {
      await service.assignRole(ATOR, ALVO.id, { roleId: 'r1', empresaDoVinculo: CRD });

      expect(prisma.userRoleAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: ALVO.id, companyId: CRD }),
        }),
      );
    });

    it('exige iam.roles.assign NA EMPRESA DESTINO — não basta ser admin da sua', async () => {
      // O ataque que esta trava fecha: virar grupo com outro cliente não pode
      // promover o admin da GDR a admin da CRD.
      mockPermissionService.hasPermission.mockResolvedValue(false);

      await expect(
        service.assignRole(ATOR, ALVO.id, { roleId: 'r1', empresaDoVinculo: CRD }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.userRoleAssignment.create).not.toHaveBeenCalled();

      expect(mockPermissionService.hasPermission).toHaveBeenCalledWith(
        ATOR.id,
        CRD,
        'iam.roles.assign',
      );
    });

    it('empresa fora do grupo → 404 (não conta que outros tenants existem)', async () => {
      await expect(
        service.assignRole(ATOR, ALVO.id, { roleId: 'r1', empresaDoVinculo: FORA }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.userRoleAssignment.create).not.toHaveBeenCalled();
    });

    it('sem grupo declarado, concessão cruzada é impossível', async () => {
      // Estado de todo tenant antes de a operadora declarar um grupo.
      mockCompanyGroup.empresasDoGrupo.mockResolvedValue([GDR]);

      await expect(
        service.assignRole(ATOR, ALVO.id, { roleId: 'r1', empresaDoVinculo: CRD }),
      ).rejects.toThrow(NotFoundException);
    });

    it('o grupo é resolvido a partir do ALVO, não do ator', async () => {
      await service.assignRole(ATOR, ALVO.id, { roleId: 'r1', empresaDoVinculo: CRD });

      expect(mockCompanyGroup.empresasDoGrupo).toHaveBeenCalledWith(ALVO.companyId);
    });

    it('sem empresaDoVinculo: caminho de sempre, sem consultar grupo nem permissão remota', async () => {
      await service.assignRole(ATOR, ALVO.id, { roleId: 'r1' });

      expect(prisma.userRoleAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ companyId: GDR }) }),
      );
      expect(mockCompanyGroup.empresasDoGrupo).not.toHaveBeenCalled();
      expect(mockPermissionService.hasPermission).not.toHaveBeenCalled();
    });
  });

  describe('removeRole de vínculo cruzado', () => {
    beforeEach(() => {
      prisma.userRoleAssignment.findUnique.mockResolvedValue({
        id: 'ura-1',
        branchId: null,
        expiresAt: null,
        role: { code: 'FINANCEIRO', name: 'Financeiro' },
      });
    });

    it('derruba a sessão do visitante NAQUELA empresa, na hora', async () => {
      // Sem isto, quem perdeu o acesso seguiria trabalhando na CRD até o
      // access token expirar sozinho.
      await service.removeRole(ATOR, ALVO.id, 'r1', CRD);

      expect(mockSessions.revokeSessionsInCompany).toHaveBeenCalledWith(CRD, {
        userId: ALVO.id,
      });
    });

    it('remoção na própria empresa não chama a revogação por empresa', async () => {
      await service.removeRole(ATOR, ALVO.id, 'r1');

      expect(mockSessions.revokeSessionsInCompany).not.toHaveBeenCalled();
    });

    it('procura o vínculo na empresa informada — a chave é userId+roleId+companyId', async () => {
      await service.removeRole(ATOR, ALVO.id, 'r1', CRD);

      expect(prisma.userRoleAssignment.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_roleId_companyId: { userId: ALVO.id, roleId: 'r1', companyId: CRD },
          },
        }),
      );
    });
  });
});
