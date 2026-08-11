/**
 * Permissão RBAC v2 que o backend exige no PATCH /users/:id
 * (user.controller.ts, @RequirePermission). O toggle Ativo/Inativo da tela
 * só aparece para quem a possui — isto é UX (evitar oferecer uma ação que
 * o backend vai negar com 403); a autorização real é o PermissionGuard.
 *
 * Desde a #1003 o gate DA PÁGINA também é RBAC v2: a página abre com
 * settings.users.view (mesmo gate do menu e do GET /users) e os botões de
 * gestão exigem settings.users.update.
 */
export const USERS_UPDATE_PERMISSION = 'settings.users.update';

/** O que o backend exige no GET /users — quem pode VER a lista. */
export const USERS_VIEW_PERMISSION = 'settings.users.view';

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
