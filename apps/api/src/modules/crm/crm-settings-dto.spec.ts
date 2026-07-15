import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateSettingsDto } from './crm.controller';
import { CrmSettings } from './crm-settings.service';

/**
 * Regressão do bug descoberto no smoke do Bloco F (15/07/2026): a tela
 * /app/crm/settings envia de volta no PATCH o objeto INTEIRO que recebeu do
 * GET /crm/settings — mas os campos de escalação de SLA (#569) nunca entraram
 * no UpdateSettingsDto, e o ValidationPipe global (forbidNonWhitelisted)
 * rejeitava a requisição inteira com "property slaEscalationEnabled should
 * not exist". Salvar QUALQUER configuração do CRM estava quebrado para todos
 * os perfis.
 *
 * Contrato travado aqui: todo campo que o GET devolve (CrmSettings) precisa
 * ser aceito pelo DTO do PATCH — quem adicionar campo novo no GET sem
 * espelhar no DTO quebra este teste, não a tela.
 */
describe('UpdateSettingsDto — aceita o round-trip do GET /crm/settings', () => {
  // mesmas opções do ValidationPipe global (main.ts)
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  // Shape completo do GET (CrmSettings) com os defaults reais do service —
  // o compilador garante que nenhum campo novo do GET fique de fora daqui.
  const fullGetResponse: CrmSettings = {
    slaFirstResponseMin: 30,
    slaEscalationEnabled: false,
    slaEscalationFactor: 2,
    coolingHours: 72,
    reopenLostDays: 30,
    autoFollowupEnabled: false,
    autoFollowupStageId: null,
    autoFollowupHours: 48,
    autoFollowupTemplate: null,
    leadRetentionDays: 0,
    sdrEnabled: false,
    sdrModel: 'claude-opus-4-8',
    sdrMaxTurns: 12,
    sdrSchedule: '24_7',
    waPhoneNumberId: null,
  };

  const asBody = (payload: unknown) =>
    pipe.transform(payload, { type: 'body', metatype: UpdateSettingsDto });

  it('payload = resposta inteira do GET → aceito (era o bug: 400 nos campos do #569)', async () => {
    await expect(asBody(fullGetResponse)).resolves.toBeDefined();
  });

  it('slaEscalationEnabled/slaEscalationFactor válidos → aceitos', async () => {
    await expect(
      asBody({ slaEscalationEnabled: true, slaEscalationFactor: 3 }),
    ).resolves.toMatchObject({ slaEscalationEnabled: true, slaEscalationFactor: 3 });
  });

  it('slaEscalationFactor < 2 → rejeitado (espelha a regra do service)', async () => {
    await expect(asBody({ slaEscalationFactor: 1 })).rejects.toThrow(BadRequestException);
  });

  it('campo desconhecido segue rejeitado (forbidNonWhitelisted preservado)', async () => {
    await expect(asBody({ naoExiste: 1 })).rejects.toThrow(BadRequestException);
  });
});
