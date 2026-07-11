/**
 * Escopo de dados por filial/loja — IAM v2, #347 fase 2 (347-A: infraestrutura).
 *
 * RBAC responde "PODE fazer a ação?" (PermissionGuard + @RequirePermission).
 * O ESCOPO responde "sobre QUAIS dados?" — este módulo define o modelo e o
 * helper central; a APLICAÇÃO nos services é das fases seguintes (347-B em
 * diante). Nada aqui altera comportamento por si só (shadow).
 *
 * Modelo (decisões Rafael, 11/07/2026 — ver docs/iam/ESCOPO-FILIAL.md):
 * - COMPANY: visão ampla da empresa (default retrocompatível — todo assignment
 *   SEM branchId significa visão global, como o sistema sempre se comportou).
 * - BRANCH: recorte por filial/loja. A Branch (gdr_branches) é a entidade de
 *   escopo; o Warehouse é a ponte operacional no ERP core (vendas/estoque/WMS/
 *   transferências já carregam warehouseId). Múltiplas lojas = múltiplos
 *   UserRoleAssignment com branchId (ex.: gerente que acumula 2 lojas).
 * - OWN: só os próprios registros (ex.: vendedor × leads no CRM). PREPARADO no
 *   modelo/helper, mas nenhum perfil o usa ainda — a decisão own×loja do CRM
 *   fica para o bloco F (#624).
 *
 * O CRM usa OUTRA representação de loja (Lead.companyId = empresa-loja) e fica
 * FORA deste mecanismo até o bloco F reconciliar os dois modelos.
 */

/** Nível de recorte de dados do usuário na empresa. */
export type ScopeLevel = 'COMPANY' | 'BRANCH' | 'OWN';

/** Escopo efetivo resolvido para um par (usuário, empresa). */
export interface EffectiveScope {
  level: ScopeLevel;
  /** Filiais do usuário (vazio quando level = COMPANY). */
  branchIds: string[];
  /**
   * Depósitos/lojas dessas filiais (Warehouse.branchId) — é o campo que os
   * services do ERP core usam para filtrar (vazio quando level = COMPANY).
   */
  warehouseIds: string[];
  /** Usuário dono do escopo (usado pelo nível OWN). */
  userId: string;
}

/** Escopo global (visão ampla da empresa) — o default retrocompatível. */
export function companyScope(userId: string): EffectiveScope {
  return { level: 'COMPANY', branchIds: [], warehouseIds: [], userId };
}

export interface ScopeWhereOptions {
  /** Nome do campo de depósito no modelo (default: 'warehouseId'). */
  warehouseField?: string;
  /** Nome do campo de dono no modelo (default: 'createdById') — nível OWN. */
  ownerField?: string;
}

/**
 * Helper CENTRAL de recorte (347-A): devolve o fragmento de `where` Prisma
 * que os services vão espalhar nas queries a partir do 347-B.
 *
 * - COMPANY → `{}` (nenhum filtro além do companyId que os services já usam);
 * - BRANCH  → `{ warehouseId: { in: [...] } }` — se a filial não tem NENHUM
 *   depósito vinculado, filtra por lista vazia (fail-closed: vê nada, em vez
 *   de vazar a empresa inteira por má configuração);
 * - OWN     → `{ createdById: userId }` (campo configurável por modelo).
 *
 * Transferências (origem OU destino na filial) e relatórios têm regras
 * próprias nas fases 347-C/347-D — este helper cobre o caso comum.
 */
export function scopeWhere(
  scope: EffectiveScope,
  opts: ScopeWhereOptions = {},
): Record<string, unknown> {
  const warehouseField = opts.warehouseField ?? 'warehouseId';
  const ownerField = opts.ownerField ?? 'createdById';

  switch (scope.level) {
    case 'COMPANY':
      return {};
    case 'BRANCH':
      return { [warehouseField]: { in: scope.warehouseIds } };
    case 'OWN':
      return { [ownerField]: scope.userId };
  }
}
