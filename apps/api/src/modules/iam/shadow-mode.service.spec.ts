import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ShadowModeService } from './shadow-mode.service';
import { PermissionService } from './permission.service';

/**
 * Testes do ShadowModeService (#340, Fase M2) — o shadow mode compara a
 * decisão do @Roles legado com o RBAC v2 e loga divergências SEM bloquear.
 */

const mockPermissionService = {
  hasAnyPermission: jest.fn(),
};

describe('ShadowModeService', () => {
  let service: ShadowModeService;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  const baseInput = {
    userId: 'u1',
    companyId: 'c1',
    enumRole: 'COMMERCIAL',
    requiredRoles: ['COMMERCIAL', 'MANAGER'],
    permissionCodes: ['sales.orders.create'],
    endpoint: '/sales',
    method: 'POST',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShadowModeService,
        { provide: PermissionService, useValue: mockPermissionService },
      ],
    }).compile();

    service = module.get(ShadowModeService);
    jest.clearAllMocks();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('MATCH quando legado e v2 concordam (ambos permitem) — sem log', async () => {
    mockPermissionService.hasAnyPermission.mockResolvedValue(true);

    const result = await service.compare(baseInput);

    expect(result).toEqual({ outcome: 'MATCH', legacyAllowed: true, v2Allowed: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('MATCH quando ambos negam', async () => {
    mockPermissionService.hasAnyPermission.mockResolvedValue(false);

    const result = await service.compare({ ...baseInput, enumRole: 'READER' });

    expect(result).toEqual({ outcome: 'MATCH', legacyAllowed: false, v2Allowed: false });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('DIVERGENCE quando legado permite e v2 nega — loga JSON estruturado', async () => {
    mockPermissionService.hasAnyPermission.mockResolvedValue(false);

    const result = await service.compare(baseInput);

    expect(result).toEqual({ outcome: 'DIVERGENCE', legacyAllowed: true, v2Allowed: false });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(payload).toMatchObject({
      event: 'iam_shadow_divergence',
      userId: 'u1',
      companyId: 'c1',
      enumRole: 'COMMERCIAL',
      permissionCodes: ['sales.orders.create'],
      endpoint: '/sales',
      method: 'POST',
      legacyAllowed: true,
      v2Allowed: false,
    });
  });

  it('DIVERGENCE quando legado nega e v2 permite', async () => {
    mockPermissionService.hasAnyPermission.mockResolvedValue(true);

    const result = await service.compare({ ...baseInput, enumRole: 'READER' });

    expect(result).toEqual({ outcome: 'DIVERGENCE', legacyAllowed: false, v2Allowed: true });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('handler sem @Roles: legado permite (réplica do RolesGuard atual)', async () => {
    mockPermissionService.hasAnyPermission.mockResolvedValue(false);

    const result = await service.compare({ ...baseInput, requiredRoles: null });

    expect(result).toEqual({ outcome: 'DIVERGENCE', legacyAllowed: true, v2Allowed: false });
  });

  it('SKIPPED quando o endpoint ainda não tem permissão v2 mapeada — não consulta o motor', async () => {
    const result = await service.compare({ ...baseInput, permissionCodes: [] });

    expect(result).toEqual({ outcome: 'SKIPPED', legacyAllowed: true });
    expect(mockPermissionService.hasAnyPermission).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ERROR: erro no motor NUNCA propaga (shadow mode não pode quebrar request)', async () => {
    mockPermissionService.hasAnyPermission.mockRejectedValue(new Error('banco caiu'));

    await expect(service.compare(baseInput)).resolves.toEqual({ outcome: 'ERROR' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
