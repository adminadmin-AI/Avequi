import { describe, expect, it } from 'vitest';
import { buildSettingsPayload } from './settings-payload';

/** Bloco F (#624, D5) — o payload de quem não tem crm.lgpd.retention-update
 *  NUNCA carrega leadRetentionDays (o backend responderia 403 na requisição
 *  inteira, sem update parcial). */
describe('buildSettingsPayload (Bloco F #624)', () => {
  const form = { slaFirstResponseMin: 15, coolingHours: 48, leadRetentionDays: 180 };

  it('sem a permissão: omite leadRetentionDays e preserva o resto', () => {
    const payload = buildSettingsPayload(form, false);
    expect(payload).toEqual({ slaFirstResponseMin: 15, coolingHours: 48 });
    expect('leadRetentionDays' in payload).toBe(false);
  });

  it('com a permissão: envia leadRetentionDays normalmente', () => {
    expect(buildSettingsPayload(form, true)).toEqual(form);
  });

  it('não muta o form original (estado do React intacto)', () => {
    buildSettingsPayload(form, false);
    expect(form.leadRetentionDays).toBe(180);
  });

  it('retenção 0 (expurgo desligado) também é omitida sem a permissão', () => {
    const payload = buildSettingsPayload({ leadRetentionDays: 0, coolingHours: 24 }, false);
    expect('leadRetentionDays' in payload).toBe(false);
    expect(payload.coolingHours).toBe(24);
  });
});
