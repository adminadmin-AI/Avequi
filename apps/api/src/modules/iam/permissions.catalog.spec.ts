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
      'crm',
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
      'workspace',
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
    // 235 = 232 + 3 da #620 (customers.addresses.create/update/delete —
    //       endereços de entrega com regra própria, decisão Rafael no PR B)
    // 240 = 235 + 5 da #621 (sales.orders.set-payments/authorize-cards/confer
    //       + sales.discount-policies.view/configure — rotas #584/#596/#491/#391
    //       que nasceram depois do catálogo, decisão Rafael no PR C)
    // 260 = 240 + 20 da #623 (E1, decisões Rafael 09/07): finance.entries.write-off;
    //       finance.provisions.{view,configure}; finance.advances.{view,create,cancel};
    //       finance.debts.{view,create,pay}; finance.reconciliation.execute;
    //       finance.billing.configure; finance.reports.export; fiscal.documents.export;
    //       finance.acquirers.{view,manage}; finance.investments.{view,manage,approve};
    //       finance.budget-plans.{view,manage}
    // 266 = 260 + 6 da #625 (bloco G, decisões Rafael 10/07):
    //       sales.carriers.{view,manage} + sales.deliveries.{view,update}
    //       + vehicle-tracking.documents.{view,manage}.
    //       (O reconcile/cancel do inventário WMS REUSA stock.inventory.* —
    //       codes que já existiam; nenhum code novo para isso.)
    // 269 = 266 + 3 da integração RENAVE/SERPRO (#529-#533, épico #527):
    //       vehicle-tracking.renave.{view,retry,manage}.
    // 298 = 269 + 29 do Bloco F/CRM (#624, decisões D1–D7 Rafael 13/07/2026):
    //       crm.leads.{view,create,move,convert,annotate,list,export,reassign,
    //       bulk-reassign,bulk-stage} + crm.conversations.view +
    //       crm.messages.send + crm.templates.{send,sync} + crm.proposals.send
    //       + crm.quick-replies.{manage,manage-all} + crm.reminders.manage-all
    //       + crm.sdr.{takeover,monitor,operate} + crm.connectors.answer +
    //       crm.distribution.view + crm.dashboard.{view,export} +
    //       crm.settings.{view,update} + crm.lgpd.{retention-update,anonymize}.
    // 299 = 298 + fiscal.nfe.return-note (#747, NF-e de devolução referenciada).
    // 301 = 299 + fiscal.nfe.{debit-note,credit-note} (#757, notas 5/6 da Reforma).
    // 302 = 301 + finance.entries.update (editar título em aberto — PATCH /finance/entries/:id).
    // 303 = 302 + crm.portfolio.view (#846, GET /crm/portfolio — KPIs de carteira).
    // 306 = 303 + workspace.{insights,tasks,agenda}.view (Home por papel F1 —
    //       BFF GET /workspace/*, conteúdo curado por permissão no service).
    // 308 = 306 + workspace.layout.{view,update} (F2 — personalização da Home,
    //       GET/PUT/DELETE /workspace/layout, sempre dado do próprio usuário).
    expect(PERMISSIONS_CATALOG.length).toBe(308);
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
