import { ENUM_ROLE_TO_SYSTEM_ROLE, resolveEffectivePermissions } from './roles.catalog';
import { PERMISSIONS_CATALOG } from './permissions.catalog';

/**
 * #947 × #946 — a prova de que o enum legado não devolve, por outra porta, os
 * poderes que este PR tirou dele.
 *
 * O #946 congela o enum e mantém um fallback de compatibilidade: quem não tem
 * NADA no RBAC v2 resolve o perfil-espelho do enum a partir do catálogo. O
 * espelho do `SUPER_ADMIN` é o `ADMIN_GLOBAL` — que, por ser dinâmico, TEM as
 * três permissões novas. Se os três pontos de decisão consultassem o fallback,
 * o #947 não teria removido poder nenhum: teria só trocado o caminho.
 *
 * Por isso os três consumidores usam `hasAnyPermission` / consulta direta ao
 * banco (RBAC v2 puro), NUNCA `resolveWithLegacyFallback`. Estes testes
 * guardam essa decisão no nível do catálogo e do código.
 */
describe('#947 × #946 — o enum não reintroduz os poderes críticos', () => {
  const CROSS_COMPANY = 'iam.tenant-scope.cross-company';
  const DISCOUNT = 'sales.discount.override';
  const BILLING_BLOCK = 'sales.orders.billing-block-override';
  const CRITICOS = [CROSS_COMPANY, DISCOUNT, BILLING_BLOCK];

  it('as três permissões existem no catálogo, com código bem formado', () => {
    const codes = PERMISSIONS_CATALOG.map((p) => p.code);
    for (const c of CRITICOS) {
      expect(codes).toContain(c);
      expect(c).toMatch(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);
    }
  });

  it('a matriz por espelho de enum é exatamente a aprovada — nem um a mais', () => {
    // Este teste documenta o RISCO que justifica a decisão dos consumidores: o
    // espelho do SUPER_ADMIN (ADMIN_GLOBAL) TEM os três, e o do DIRECTOR tem
    // os dois comerciais. É por isso que os pontos de decisão não podem honrar
    // o fallback legado — honrá-lo devolveria pelo enum o que o #947 tirou.
    // Os outros oito espelhos não têm nada disso, nem por acidente.
    const esperado: Record<string, string[]> = {
      SUPER_ADMIN: CRITICOS,
      DIRECTOR: [DISCOUNT, BILLING_BLOCK],
    };

    for (const [enumRole, roleCode] of Object.entries(ENUM_ROLE_TO_SYSTEM_ROLE)) {
      const perms = resolveEffectivePermissions(roleCode);
      const temEsperado = esperado[enumRole] ?? [];
      const temDeFato = CRITICOS.filter((c) => perms.includes(c));
      expect({ [enumRole]: temDeFato.sort() }).toEqual({ [enumRole]: [...temEsperado].sort() });
    }
  });

  it('o espelho do enum DIRECTOR não recebe o escopo cross-company', () => {
    // O DIRETOR ganhou os dois poderes comerciais, mas atravessar empresas
    // continua sendo exclusividade do ADMIN_GLOBAL.
    const perms = resolveEffectivePermissions(ENUM_ROLE_TO_SYSTEM_ROLE.DIRECTOR);
    expect(perms).toContain(DISCOUNT);
    expect(perms).toContain(BILLING_BLOCK);
    expect(perms).not.toContain(CROSS_COMPANY);
  });

  it('o espelho do enum MANAGER (GERENTE_GERAL) não recebe nenhum dos três', () => {
    const perms = resolveEffectivePermissions(ENUM_ROLE_TO_SYSTEM_ROLE.MANAGER);
    for (const critico of CRITICOS) {
      expect(perms).not.toContain(critico);
    }
  });

  it('os consumidores NÃO chamam resolveWithLegacyFallback', () => {
    // Guarda de código: se alguém trocar hasAnyPermission por
    // resolveWithLegacyFallback num destes arquivos, o poder volta pelo enum.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const arquivos = [
      'src/modules/sales/discount-policy.service.ts',
      'src/modules/sales/sales.service.ts',
      'src/modules/iam/tenant-scope.service.ts',
    ];
    for (const arquivo of arquivos) {
      const src: string = fs.readFileSync(arquivo, 'utf-8');
      // aparece só em COMENTÁRIO explicando por que não é usado
      const chamadas = src
        .split('\n')
        .filter((l) => l.includes('resolveWithLegacyFallback'))
        .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'));
      expect(chamadas).toEqual([]);
    }
  });
});
