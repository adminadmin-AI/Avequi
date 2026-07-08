import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuditAction } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { allPermissionCodes } from './permissions.catalog';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController — GET /iam/audit-logs (#343)', () => {
  let controller: AuditController;
  let mockAuditService: { findLogs: jest.Mock };

  beforeEach(async () => {
    mockAuditService = {
      findLogs: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      }),
    };

    const module = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: mockAuditService }],
    }).compile();

    controller = module.get(AuditController);
  });

  it('NÃO usa mais @Roles — gate único RBAC v2 (#341 parte 2)', () => {
    const reflector = new Reflector();
    // O @Roles('SUPER_ADMIN') foi removido: era redundante E bloqueava
    // ADMIN_EMPRESA/AUDITOR, que TÊM iam.audit-logs.view pela matriz aprovada.
    expect(reflector.get<string[]>(ROLES_KEY, controller.list)).toBeUndefined();
  });

  it('exige iam.audit-logs.view via @RequirePermission (gate efetivo) — #341', () => {
    const reflector = new Reflector();
    const required = reflector.get<string[]>(REQUIRE_PERMISSION_KEY, controller.list);
    expect(required).toEqual(['iam.audit-logs.view']);
    expect(allPermissionCodes()).toContain('iam.audit-logs.view');
  });

  it('escopa a consulta pela companyId do JWT (nunca por query — anti-IDOR)', async () => {
    const user = { id: 'admin-1', companyId: 'co-1', role: 'SUPER_ADMIN' };

    await controller.list(user, {
      entity: 'Product',
      action: AuditAction.UPDATE,
      page: 2,
      pageSize: 10,
    });

    expect(mockAuditService.findLogs).toHaveBeenCalledWith(
      'co-1',
      expect.objectContaining({
        entity: 'Product',
        action: AuditAction.UPDATE,
        page: 2,
        pageSize: 10,
      }),
    );
  });

  it('repassa o resultado paginado do service', async () => {
    const payload = { data: [{ id: 'log-1' }], total: 1, page: 1, pageSize: 50, totalPages: 1 };
    mockAuditService.findLogs.mockResolvedValue(payload);

    const result = await controller.list({ companyId: 'co-1' }, {});
    expect(result).toEqual(payload);
  });
});
