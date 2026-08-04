import type { TenantStatus } from '@/types/api';
import type { BadgeVariant } from '@/components/ui/badge';

/**
 * Rótulos/cores do ciclo de vida da conta (TenantStatus) — fonte única do
 * console da operadora.
 *
 * Painel da Operadora (#957): o mesmo mapa passou a ser lido por três telas
 * (painel, lista de contas e detalhe), que até aqui carregavam cópias
 * idênticas. Convenção do repo: rótulo/variante puros em `.ts` (ver
 * `billing-format.ts`).
 */
export const STATUS_LABEL: Record<TenantStatus, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  CHURNED: 'Encerrada',
  SANDBOX: 'Sandbox',
};

export const STATUS_VARIANT: Record<TenantStatus, BadgeVariant> = {
  TRIAL: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  CHURNED: 'neutral',
  SANDBOX: 'warning',
};

/**
 * Ordem de leitura dos chips de carteira no painel (#957): do saudável ao
 * encerrado. SANDBOX fica FORA — conta de teste não é carteira e aparece
 * separada, discreta (o backend também a devolve num campo próprio).
 */
export const CARTEIRA_STATUS_ORDER: TenantStatus[] = [
  'ACTIVE',
  'TRIAL',
  'SUSPENDED',
  'CHURNED',
];
