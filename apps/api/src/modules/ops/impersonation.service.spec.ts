import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { SessionDenylistService } from '../iam/session-denylist.service';
import { IMPERSONATION_SCOPE } from './impersonation.constants';
import { ImpersonationService } from './impersonation.service';

/**
 * OPS WP6 (#913) — visita read-only. Contratos: motivo obrigatório; alvo tem
 * que ser usuário ATIVO da árvore do tenant; token dedicado com claims certas
 * (scope/iid/impersonatorId/readOnly, 30min); início e fim auditados; fim
 * antecipado vai pra denylist do iid; support-access lê pela RAIZ.
 */
const mockPrisma = {
  company: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
  user: { findFirst: jest.fn() },
  auditLogV2: { findMany: jest.fn() },
};
const mockJwt = { sign: jest.fn().mockReturnValue('imp-token') };
const mockAudit = { persist: jest.fn().mockResolvedValue(undefined) };
const mockDenylist = { deny: jest.fn().mockResolvedValue(undefined) };

const CTX = { userId: 'op-1', actorCompanyId: 'avecchi', sessionId: 's1', ipAddress: '1.1.1.1', userAgent: 'jest' };
const TARGET = { id: 'u-alvo', name: 'Maria', email: 'maria@crd.com.br', role: 'MANAGER', companyId: 'filial-1' };

describe('ImpersonationService (OPS WP6 #913)', () => {
  let service: ImpersonationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpersonationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: AuditService, useValue: mockAudit },
        { provide: SessionDenylistService, useValue: mockDenylist },
      ],
    }).compile();
    service = module.get(ImpersonationService);
    jest.clearAllMocks();
    mockJwt.sign.mockReturnValue('imp-token');
    mockPrisma.company.findUnique.mockResolvedValue({ id: 'root-1', parentId: null });
    mockPrisma.user.findFirst.mockResolvedValue(TARGET);
  });

  it('sem motivo → 400, nada assinado', async () => {
    await expect(service.start('root-1', 'u-alvo', ' ', CTX)).rejects.toThrow(BadRequestException);
    expect(mockJwt.sign).not.toHaveBeenCalled();
  });

  it('filial como tenant → 404; usuário fora da árvore/inativo → 404', async () => {
    mockPrisma.company.findUnique.mockResolvedValue({ id: 'f1', parentId: 'root-1' });
    await expect(service.start('f1', 'u', 'motivo válido', CTX)).rejects.toThrow(NotFoundException);

    mockPrisma.company.findUnique.mockResolvedValue({ id: 'root-1', parentId: null });
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(service.start('root-1', 'u-de-outro', 'motivo válido', CTX)).rejects.toThrow(NotFoundException);
    // consulta amarra o alvo à árvore do tenant E isActive
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          company: { OR: [{ id: 'root-1' }, { parentId: 'root-1' }] },
        }),
      }),
    );
  });

  it('claims do token: alvo + scope + iid + impersonatorId + readOnly, 30min; audit EXECUTE com motivo', async () => {
    const result = await service.start('root-1', 'u-alvo', 'Chamado #AVQ-123', CTX);
    const [claims, opts] = mockJwt.sign.mock.calls[0];
    expect(claims).toMatchObject({
      sub: 'u-alvo',
      companyId: 'filial-1',
      scope: IMPERSONATION_SCOPE,
      impersonatorId: 'op-1',
      readOnly: true,
    });
    expect(claims.iid).toMatch(/^[a-f0-9]{32}$/);
    expect(opts).toEqual({ expiresIn: '30m' });
    expect(mockAudit.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'root-1',
        userId: 'op-1',
        entity: 'Impersonation',
        action: AuditAction.EXECUTE,
        module: 'ops',
        newValue: expect.objectContaining({ reason: 'Chamado #AVQ-123', readOnly: true }),
      }),
    );
    expect(result.impersonationToken).toBe('imp-token');
    expect(result.target.email).toBe('maria@crd.com.br');
  });

  it('end: denylist do iid (TTL > vida do token) + audit CANCEL', async () => {
    await service.end('root-1', 'iid-x', CTX);
    expect(mockDenylist.deny).toHaveBeenCalledWith('iid-x', 30 * 60 + 300);
    expect(mockAudit.persist).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'Impersonation', entityId: 'iid-x', action: AuditAction.CANCEL }),
    );
  });

  it('support-access: lê pela RAIZ do tenant do usuário, só entity Impersonation', async () => {
    mockPrisma.company.findUniqueOrThrow.mockResolvedValue({ id: 'f1', parentId: 'root-1' });
    mockPrisma.auditLogV2.findMany.mockResolvedValue([]);
    await service.listSupportAccess('f1');
    expect(mockPrisma.auditLogV2.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'root-1', module: 'ops', entity: 'Impersonation' },
      }),
    );
  });
});
