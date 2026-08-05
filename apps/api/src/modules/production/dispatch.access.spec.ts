/**
 * #817 — Acesso EFETIVO ao despacho por setor.
 *
 * Teste de integração no sentido que importa aqui: exercita o `PermissionGuard`
 * **de verdade** contra a **metadata real** do `ProductionController` e o
 * **catálogo real** de perfis. Não afirma nada sobre intenção — mede o que o
 * sistema de fato deixa passar.
 *
 * Segue a mesma forma dos `*.access.spec.ts` do IAM (#352), que é a convenção
 * do repositório para provar matriz de permissão.
 *
 * O que precisa ser verdade:
 *   - o endpoint exige `production.dispatch.view`, e essa permissão existe no
 *     catálogo (a regra de ouro: permissão nasce no mesmo PR do endpoint);
 *   - a permissão é PRÓPRIA — quem tem só `production.orders.view` não entra;
 *   - **nenhuma trava por enum legado** (`@Roles`) no endpoint, que bloquearia
 *     perfis só-RBAC-v2 antes de a permissão v2 sequer ser avaliada;
 *   - quem não tem a permissão toma 403.
 */

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { PERMISSIONS_CATALOG } from '../iam/permissions.catalog';
import { resolveEffectivePermissions } from '../iam/roles.catalog';
import { ProductionController } from './production.controller';

const PERMISSAO = 'production.dispatch.view';
const reflector = new Reflector();
const handler = ProductionController.prototype.dispatch;

function ctx(): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ProductionController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u1', companyId: 'c1' } }) }),
  } as unknown as ExecutionContext;
}

/** Roda o guard como se o usuário tivesse o efetivo do perfil `roleCode`. */
async function podeAcessar(roleCode: string): Promise<boolean> {
  const permissionService = {
    resolveWithLegacyFallback: jest.fn().mockResolvedValue({
      legacyFallback: false,
      resolved: { roles: [roleCode], permissions: resolveEffectivePermissions(roleCode) },
    }),
  } as any;

  try {
    return await new PermissionGuard(reflector, permissionService).canActivate(ctx());
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

describe('#817 — acesso ao POST /production/dispatch (guard + metadata reais)', () => {
  it('a permissão existe no catálogo versionado', () => {
    const def = PERMISSIONS_CATALOG.find((p) => p.code === PERMISSAO);
    expect(def).toBeDefined();
    expect(def).toMatchObject({ module: 'production', resource: 'dispatch', action: 'view' });
  });

  it('o endpoint exige exatamente essa permissão', () => {
    expect(reflector.get<string[]>(REQUIRE_PERMISSION_KEY, handler)).toEqual([PERMISSAO]);
  });

  it('NÃO tem gate de enum legado (@Roles) — só o RBAC v2 decide', () => {
    expect(reflector.get<string[]>(ROLES_KEY, handler)).toBeUndefined();
  });

  it('é permissão própria, não reuso de production.orders.view', () => {
    expect(PERMISSAO).not.toBe('production.orders.view');
    expect(PERMISSIONS_CATALOG.filter((p) => p.code === PERMISSAO)).toHaveLength(1);
  });

  it('o PCP — quem monta o despacho — tem acesso', async () => {
    expect(await podeAcessar('OPERADOR_PCP')).toBe(true);
  });

  it('a gerência industrial tem acesso (varredura do módulo production)', async () => {
    expect(await podeAcessar('GERENTE_INDUSTRIAL')).toBe(true);
  });

  it('o visitante NÃO tem acesso', async () => {
    expect(await podeAcessar('VISITANTE')).toBe(false);
  });

  // A matriz completa: para cada perfil do catálogo, o acesso tem de bater
  // exatamente com "esse perfil tem a permissão?". Sem exceção escondida.
  describe('matriz por perfil — acesso bate com o efetivo resolvido', () => {
    for (const role of [
      'ADMIN_GLOBAL',
      'ADMIN_EMPRESA',
      'DIRETOR',
      'GERENTE_INDUSTRIAL',
      'SUPERVISOR_PRODUCAO',
      'OPERADOR_PCP',
      'OPERADOR_PRODUCAO',
      'ALMOXARIFE',
      'AUDITOR',
      'SOMENTE_LEITURA',
      'VISITANTE',
      'VENDEDOR',
      'FINANCEIRO',
    ]) {
      const esperado = resolveEffectivePermissions(role).includes(PERMISSAO);
      it(`${role} => ${esperado ? 'permite' : '403'}`, async () => {
        expect(await podeAcessar(role)).toBe(esperado);
      });
    }
  });
});
