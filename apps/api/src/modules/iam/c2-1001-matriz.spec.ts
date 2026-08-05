import { SYSTEM_ROLES, resolveEffectivePermissions, ENUM_ROLE_TO_SYSTEM_ROLE } from './roles.catalog';
import { PERMISSIONS_CATALOG } from './permissions.catalog';

/**
 * #1001-C2 — a matriz aprovada pelo Rafael, congelada em teste.
 *
 * As duas permissões novas governam poderes que antes moravam no enum:
 * ver a comissão (e o percentual) dos outros, e revogar a sessão de terceiros.
 * Nos dois casos o risco não é esquecer de conceder — é conceder DEMAIS, sem
 * ninguém decidir, por varredura de módulo.
 */
describe('#1001-C2 — matriz das permissões novas', () => {
  const VIEW_ALL = 'sales.commissions.view-all';
  const REVOKE_ANY = 'iam.sessions.revoke-any';

  /** Matriz aprovada — 11 perfis. */
  const COM_VIEW_ALL = [
    'ADMIN_GLOBAL',
    'ADMIN_EMPRESA',
    'ADMIN_FILIAL',
    'DIRETOR',
    'GERENTE_GERAL',
    'GERENTE_COMERCIAL',
    'COORDENADOR_COMERCIAL',
    'GERENTE_LOJA',
    'GERENTE_FINANCEIRO',
    'FINANCEIRO',
    'AUDITOR',
  ];

  /** Matriz aprovada — 2 perfis. Poder de segurança, não operacional. */
  const COM_REVOKE_ANY = ['ADMIN_GLOBAL', 'ADMIN_EMPRESA'];

  const quemTem = (code: string) =>
    (SYSTEM_ROLES as { code: string }[])
      .filter((r) => resolveEffectivePermissions(r.code).includes(code))
      .map((r) => r.code)
      .sort();

  it('as duas permissões existem no catálogo, com código bem formado', () => {
    const codes = PERMISSIONS_CATALOG.map((p) => p.code);
    for (const c of [VIEW_ALL, REVOKE_ANY]) {
      expect(codes).toContain(c);
      expect(c).toMatch(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);
    }
  });

  it('sales.commissions.view-all: exatamente os 11 perfis aprovados', () => {
    expect(quemTem(VIEW_ALL)).toEqual([...COM_VIEW_ALL].sort());
  });

  it('GERENTE_LOJA vê a equipe da loja, mas não ganha configure nem revoke-any', () => {
    // Decisão Rafael: administra a equipe comercial da filial. A permissão é
    // só de LEITURA ampla — não arrasta configuração nem poder de sessão. E o
    // escopo segue sendo a Company do JWT (a filial), sem visão cross-tenant.
    const perms = resolveEffectivePermissions('GERENTE_LOJA');
    expect(perms).toContain(VIEW_ALL);
    expect(perms).toContain('sales.commissions.view');
    expect(perms).not.toContain('sales.commissions.configure');
    expect(perms).not.toContain(REVOKE_ANY);
  });

  it('iam.sessions.revoke-any: exatamente ADMIN_GLOBAL e ADMIN_EMPRESA', () => {
    expect(quemTem(REVOKE_ANY)).toEqual([...COM_REVOKE_ANY].sort());
  });

  it('ADMIN_FILIAL recebe view-all mas NÃO revoke-any', () => {
    // Decisão do Rafael: não há vínculo de filial confiável no registro da
    // sessão para limitar a revogação com segurança. Comissão é diferente —
    // Commission.companyId já amarra ao escopo da filial.
    const perms = resolveEffectivePermissions('ADMIN_FILIAL');
    expect(perms).toContain(VIEW_ALL);
    expect(perms).not.toContain(REVOKE_ANY);
  });

  it('AUDITOR vê tudo mas NÃO configura — visão ampla não vira poder de escrita', () => {
    const perms = resolveEffectivePermissions('AUDITOR');
    expect(perms).toContain(VIEW_ALL);
    expect(perms).toContain('sales.commissions.view');
    expect(perms).not.toContain('sales.commissions.configure');
    expect(perms).not.toContain('sales.commissions.approve');
  });

  it('GERENTE_INDUSTRIAL não ganha visão ampla por varredura de sales', () => {
    // Ele recebe vendas por moduleCodes e não tem responsabilidade comercial
    // nenhuma. É o caso que justifica a lista de exceção.
    const perms = resolveEffectivePermissions('GERENTE_INDUSTRIAL');
    expect(perms).toContain('sales.commissions.view'); // continua vendo as próprias
    expect(perms).not.toContain(VIEW_ALL);
  });

  it('VENDEDOR vê as próprias e nada além', () => {
    const perms = resolveEffectivePermissions('VENDEDOR');
    expect(perms).toContain('sales.commissions.view');
    expect(perms).not.toContain(VIEW_ALL);
  });

  it('SOMENTE_LEITURA não vê comissão nenhuma', () => {
    const perms = resolveEffectivePermissions('SOMENTE_LEITURA');
    expect(perms).not.toContain('sales.commissions.view');
    expect(perms).not.toContain(VIEW_ALL);
  });

  it('nenhum perfil operacional recebe as permissões por varredura', () => {
    for (const code of ['COMPRADOR', 'ALMOXARIFE', 'OPERADOR_PRODUCAO', 'OPERADOR_PCP', 'LOJA_OPERACIONAL']) {
      const perms = resolveEffectivePermissions(code);
      expect({ [code]: perms.includes(VIEW_ALL) }).toEqual({ [code]: false });
      expect({ [code]: perms.includes(REVOKE_ANY) }).toEqual({ [code]: false });
    }
  });

  it('a matriz por espelho de enum é exatamente a aprovada — nem um a mais', () => {
    // Documenta o RISCO que justifica os consumidores usarem RBAC v2 puro.
    //
    // QUATRO dos dez espelhos carregam pelo menos uma das permissões novas: o
    // do SUPER_ADMIN (ADMIN_GLOBAL) tem as duas, e os de DIRECTOR, MANAGER e
    // FINANCIAL têm `view-all` — porque DIRETOR, GERENTE_GERAL e FINANCEIRO
    // estão na matriz aprovada. Se os pontos de decisão honrassem o fallback
    // do #946, um usuário SEM nada no v2 resolveria pelo espelho e receberia
    // exatamente o poder que esta issue passa a exigir por permissão.
    //
    // É por isso que `commission.controller` e `auth.controller` usam
    // `hasAnyPermission` (v2 puro) e nunca `resolveWithLegacyFallback`.
    const esperado: Record<string, string[]> = {
      SUPER_ADMIN: [VIEW_ALL, REVOKE_ANY],
      DIRECTOR: [VIEW_ALL],
      MANAGER: [VIEW_ALL],
      FINANCIAL: [VIEW_ALL],
    };
    for (const [enumRole, roleCode] of Object.entries(ENUM_ROLE_TO_SYSTEM_ROLE)) {
      const perms = resolveEffectivePermissions(roleCode);
      const tem = [VIEW_ALL, REVOKE_ANY].filter((c) => perms.includes(c)).sort();
      expect({ [enumRole]: tem }).toEqual({ [enumRole]: [...(esperado[enumRole] ?? [])].sort() });
    }
  });

  it('os consumidores NÃO chamam resolveWithLegacyFallback', () => {
    // Guarda de código: trocar hasAnyPermission por resolveWithLegacyFallback
    // em qualquer um destes arquivos devolveria o poder pelo enum.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    for (const arquivo of [
      'src/modules/commission/commission.controller.ts',
      'src/modules/auth/auth.controller.ts',
    ]) {
      const src: string = fs.readFileSync(arquivo, 'utf-8');
      const chamadas = src
        .split('\n')
        .filter((l) => l.includes('resolveWithLegacyFallback'))
        .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'));
      expect({ [arquivo]: chamadas }).toEqual({ [arquivo]: [] });
    }
  });

  it('o enum não decide mais nos dois consumidores', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const semComentarios = (p: string) =>
      fs
        .readFileSync(p, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    expect(semComentarios('src/modules/commission/commission.controller.ts')).not.toMatch(
      /user\.role\s*===/,
    );
    expect(semComentarios('src/modules/auth/auth.controller.ts')).not.toMatch(
      /user\.role\s*===\s*'SUPER_ADMIN'/,
    );
  });
});
