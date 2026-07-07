import {
  PERMISSIONS_CATALOG,
  PERMISSION_CODE_REGEX,
  allPermissionCodes,
  moduleCodes,
  resourceCodes,
  actionCodes,
  catalogModules,
} from './permissions.catalog';

describe('Catálogo de permissões (#338)', () => {
  it('não tem codes duplicados', () => {
    const codes = allPermissionCodes();
    const duplicados = codes.filter((c, i) => codes.indexOf(c) !== i);
    expect(duplicados).toEqual([]);
  });

  it('todos os codes seguem o formato modulo.recurso.acao (kebab-case minúsculo)', () => {
    const invalidos = PERMISSIONS_CATALOG.filter(
      (p) => !PERMISSION_CODE_REGEX.test(p.code),
    ).map((p) => p.code);
    expect(invalidos).toEqual([]);
  });

  it('code é sempre a concatenação de module.resource.action', () => {
    const inconsistentes = PERMISSIONS_CATALOG.filter(
      (p) => p.code !== `${p.module}.${p.resource}.${p.action}`,
    ).map((p) => p.code);
    expect(inconsistentes).toEqual([]);
  });

  it('toda permissão tem name em pt-BR não vazio', () => {
    const semNome = PERMISSIONS_CATALOG.filter(
      (p) => !p.name || p.name.trim().length === 0,
    ).map((p) => p.code);
    expect(semNome).toEqual([]);
  });

  it('cobre exatamente os módulos esperados (nenhum módulo sem permissões)', () => {
    const esperados = [
      'dashboard',
      'analytics',
      'products',
      'customers',
      'suppliers',
      'sales',
      'purchases',
      'stock',
      'production',
      'quality',
      'maintenance',
      'finance',
      'fiscal',
      'settings',
      'approvals',
      'lgpd',
      'iam',
      'vehicle-tracking',
    ];
    expect(catalogModules().sort()).toEqual([...esperados].sort());
    for (const modulo of esperados) {
      expect(moduleCodes(modulo).length).toBeGreaterThan(0);
    }
  });

  it('tem o total esperado de permissões (guarda contra edição acidental)', () => {
    // Se este número mudar, foi intencional? Atualize junto com o PR que
    // adiciona/remove endpoints.
    // 229 = 226 + 3 da #352 (iam.roles.view / iam.roles.manage / iam.roles.assign)
    // 232 = 229 + 3 da #347 (iam.org.view / iam.org.manage / iam.org.assign)
    expect(PERMISSIONS_CATALOG.length).toBe(232);
  });

  it('todo módulo tem pelo menos uma permissão de leitura (hierarquia verificável)', () => {
    for (const modulo of catalogModules()) {
      expect(actionCodes('view', [modulo]).length).toBeGreaterThan(0);
    }
  });

  describe('helpers', () => {
    it('resourceCodes retorna só o recurso pedido', () => {
      const codes = resourceCodes('sales', 'orders');
      expect(codes).toContain('sales.orders.create');
      expect(codes.every((c) => c.startsWith('sales.orders.'))).toBe(true);
    });

    it('actionCodes filtra por ação e módulos', () => {
      const views = actionCodes('view', ['finance']);
      expect(views.length).toBeGreaterThan(0);
      expect(views.every((c) => c.startsWith('finance.') && c.endsWith('.view'))).toBe(true);
    });
  });

  describe('permissões sensíveis existem (âncoras da matriz RBAC)', () => {
    it.each([
      'sales.orders.invoice',
      'fiscal.nfe.cancel',
      'finance.entries.pay',
      'stock.movements.reverse',
      'production.orders.execute',
      'approvals.requests.approve',
      'lgpd.anonymization.process',
      'settings.users.create',
      'iam.audit-logs.view',
    ])('%s está no catálogo', (code) => {
      expect(allPermissionCodes()).toContain(code);
    });
  });
});
