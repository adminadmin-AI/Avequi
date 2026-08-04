import { apiClient } from '@/lib/api-client';

/**
 * Pouso pós-login por papel (OPS F2, decisão do Claudio 03/08): quem opera o
 * SaaS (qualquer permissão ops.*) entra DIRETO no console da operadora — o
 * ERP do tenant vira o destino secundário, alcançável pelo switcher
 * "Voltar ao ERP". Fail-soft: se a consulta falhar, cai no /app de sempre
 * (o RouteGuard cobre o resto). O custo é ~zero: o endpoint tem cache no
 * backend e é a primeira coisa que o app pediria ao montar de qualquer jeito.
 *
 * Compartilhado entre o login e a troca de senha forçada (#735): o primeiro
 * acesso de um operador (senha provisória) também tem que pousar no console.
 */
export async function destinoPosLogin(): Promise<string> {
  try {
    const { data } = await apiClient.get<{ permissions?: string[] }>('/auth/me/permissions');
    if ((data?.permissions ?? []).some((p) => p.startsWith('ops.'))) return '/app/ops';
  } catch {
    /* indeterminado → destino padrão */
  }
  return '/app';
}
