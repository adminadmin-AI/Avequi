/**
 * Bloco F (#624, D5): monta o payload do PATCH /crm/settings respeitando a
 * permissão de retenção LGPD. O backend recusa a requisição INTEIRA (403,
 * sem update parcial) se `leadRetentionDays` vier no payload de quem não tem
 * `crm.lgpd.retention-update` — por isso quem não pode alterá-la NUNCA envia
 * o campo (as demais configurações salvam normalmente).
 *
 * Isto é UX, não segurança: a validação real é o backend.
 */
export function buildSettingsPayload<T extends { leadRetentionDays?: number }>(
  form: T,
  canEditRetention: boolean,
): T {
  const payload = { ...form };
  if (!canEditRetention) delete payload.leadRetentionDays;
  return payload;
}
