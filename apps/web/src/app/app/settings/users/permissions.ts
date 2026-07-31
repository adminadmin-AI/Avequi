/**
 * Permissão RBAC v2 que o backend exige no PATCH /users/:id
 * (user.controller.ts, @RequirePermission). O toggle Ativo/Inativo da tela
 * só aparece para quem a possui — isto é UX (evitar oferecer uma ação que
 * o backend vai negar com 403); a autorização real é o PermissionGuard.
 *
 * ⚠️ O gate DA PÁGINA inteira ainda é o enum legado (ALLOWED_ROLES) — a
 * migração integral para RBAC v2 permanece no escopo da #351 parte 2.
 */
export const USERS_UPDATE_PERMISSION = 'settings.users.update';

export function canShowStatusToggle(can: (code: string) => boolean): boolean {
  return can(USERS_UPDATE_PERMISSION);
}

/**
 * Redefinir senha (#750) usa o MESMO PATCH /users/:id { password } — logo o
 * mesmo code. Função separada para o dia em que o backend ganhar um code
 * dedicado (ex.: settings.users.reset-password): muda aqui, não na tela.
 */
export function canShowPasswordReset(can: (code: string) => boolean): boolean {
  return can(USERS_UPDATE_PERMISSION);
}
