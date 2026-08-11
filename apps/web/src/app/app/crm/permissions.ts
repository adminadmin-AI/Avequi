/**
 * Gates de UI do CRM por permissão v2 (#1003) — helper único para o toggle
 * de escopo mine/all não divergir entre as telas que o usam (funil e SLA).
 *
 * ⚠️ O backend NÃO restringe `scope=all`: qualquer usuário com crm.leads.view
 * pode pedir a loja inteira via API (herança pré-#624). O toggle segue
 * gerencial por decisão de UX, usando crm.leads.bulk-stage como proxy — os
 * mesmos perfis que o enum antigo liberava. Quando nascer uma permissão
 * própria (ex.: crm.leads.view-all), troca-se AQUI, uma vez só.
 *
 * Nota: crm/inbox tem o mesmo toggle SEM gate nenhum (comportamento herdado,
 * não alterado neste PR) — se um dia for padronizar, é este helper lá também.
 */
export function canSeeAllLeads(can: (code: string) => boolean): boolean {
  return can('crm.leads.bulk-stage');
}
