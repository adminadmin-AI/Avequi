import { SetMetadata } from '@nestjs/common';

/**
 * ⚠️ INERTE desde a #948-C1 — não use em rota nova.
 *
 * O `RolesGuard` que lia esta metadata foi removido: nenhuma rota carregava
 * `@Roles()`, então ele liberava tudo. Aplicar o decorator hoje NÃO protege
 * nada — a rota fica aberta a qualquer autenticado. Para gatear, use
 * `@RequirePermission('modulo.recurso.acao')`.
 *
 * O arquivo sobrevive porque `ROLES_KEY` é a CHAVE DE DETECÇÃO usada pelo
 * `route-gate-coverage.spec` e pelos `*.access.spec`: é assim que os testes
 * provam que o enum legado não voltou a gatear rota nenhuma. Um deles falha
 * se alguém aplicar `@Roles` de novo.
 *
 * A remoção definitiva do enum `User.role` é a Fase D da #780.
 */
export const ROLES_KEY = 'roles';

/** @deprecated Inerte — ver nota acima. Use `@RequirePermission`. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
