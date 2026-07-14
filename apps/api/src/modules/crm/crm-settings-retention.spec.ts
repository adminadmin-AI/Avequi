import { ForbiddenException } from '@nestjs/common';
import { CrmController } from './crm.controller';

/**
 * Bloco F (#624, D5) — contrato do PATCH /crm/settings:
 * payload contendo leadRetentionDays exige crm.lgpd.retention-update; sem a
 * permissão, 403 na requisição INTEIRA — o campo não é ignorado e NENHUM
 * outro campo é persistido (sem update parcial). O expurgo comandado pela
 * retenção é anonimização em massa irreversível.
 */
describe('PATCH /crm/settings — retenção LGPD condicional (Bloco F #624)', () => {
  const user = { id: 'u1', companyId: 'c1' };

  function controllerWith(hasRetentionPermission: boolean) {
    const settings = { update: jest.fn().mockResolvedValue({ ok: true }) };
    const permissions = {
      hasPermission: jest.fn(
        async (_u: string, _c: string, code: string) =>
          code === 'crm.lgpd.retention-update' && hasRetentionPermission,
      ),
    };
    // só os colaboradores usados pelo handler importam; o resto é irrelevante
    const controller = new CrmController(
      undefined as any, // leadIntake
      undefined as any, // crm
      undefined as any, // funnel
      undefined as any, // conversion
      undefined as any, // dashboard
      undefined as any, // templates
      settings as any, // settings
      undefined as any, // quickReplies
      undefined as any, // reminders
      undefined as any, // leadList
      undefined as any, // leadLgpd
      undefined as any, // sdr
      undefined as any, // sdrDashboard
      undefined as any, // proposals
      permissions as any, // permissions (IAM v2)
    );
    return { controller, settings, permissions };
  }

  it('SEM a permissão + payload COM leadRetentionDays → 403 e NADA é persistido', async () => {
    const { controller, settings } = controllerWith(false);
    await expect(
      controller.updateSettings({ slaFirstResponseMin: 10, leadRetentionDays: 1 } as any, user),
    ).rejects.toThrow(ForbiddenException);
    expect(settings.update).not.toHaveBeenCalled(); // sem update parcial
  });

  it('SEM a permissão + payload SEM o campo → salva o resto normalmente (perfis 27/29)', async () => {
    const { controller, settings } = controllerWith(false);
    await controller.updateSettings({ slaFirstResponseMin: 10, coolingHours: 48 } as any, user);
    expect(settings.update).toHaveBeenCalledWith('c1', {
      slaFirstResponseMin: 10,
      coolingHours: 48,
    });
  });

  it('COM a permissão (4 perfis LGPD) → altera a retenção normalmente', async () => {
    const { controller, settings } = controllerWith(true);
    await controller.updateSettings({ leadRetentionDays: 180 } as any, user);
    expect(settings.update).toHaveBeenCalledWith('c1', { leadRetentionDays: 180 });
  });

  it('retenção 0 (desligar expurgo) também exige a permissão — 0 não é "ausente"', async () => {
    const { controller, settings } = controllerWith(false);
    await expect(
      controller.updateSettings({ leadRetentionDays: 0 } as any, user),
    ).rejects.toThrow(ForbiddenException);
    expect(settings.update).not.toHaveBeenCalled();
  });
});
