import type { FinancialEntryStatus } from '@/types/api';

/**
 * Regra de "editável" da Carteira de Pagáveis — pura, testável e ESPELHA a
 * trava do backend (`FinanceService.updateEntry`: só OPEN/OVERDUE) e o gate de
 * permissão (`@RequirePermission('finance.entries.update')`).
 *
 * O botão de editar é UX; a segurança real está no backend. Mas a UI não deve
 * oferecer uma ação que o backend recusaria.
 */
const EDITABLE_STATUSES: FinancialEntryStatus[] = ['OPEN', 'OVERDUE'];

/** Título em aberto sem baixa (mesmos status editáveis do backend). */
export function isEditableStatus(status: FinancialEntryStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** Mostra o lápis? Precisa ter a permissão E o status ser editável. */
export function canEditEntry(status: FinancialEntryStatus, canUpdate: boolean): boolean {
  return canUpdate && isEditableStatus(status);
}
