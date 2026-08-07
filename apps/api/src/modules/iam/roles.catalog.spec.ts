import { UserRole } from '@prisma/client';
import {
  allPermissionCodes,
  moduleCodes,
  tenantPermissionCodes,
} from './permissions.catalog';
import {
  SYSTEM_ROLES,
  ENUM_ROLE_TO_SYSTEM_ROLE,
  findSystemRole,
  resolveEffectivePermissions,
} from './roles.catalog';

describe('Catálogo de perfis system (#339)', () => {
  const catalogo = new Set(allPermissionCodes());

  it('tem exatamente 29 perfis (28 da #339/#463 + AVECCHI_OPERATOR do OPS WP1 #908)', () => {
    expect(SYSTEM_ROLES.length).toBe(29);
  });

  it('não tem codes de perfil duplicados', () => {
    const codes = SYSTEM_ROLES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('todo perfil referencia apenas permissões existentes no catálogo', () => {
    for (const role of SYSTEM_ROLES) {
      const inexistentes = role.permissions.filter((p) => !catalogo.has(p));
      expect({ perfil: role.code, inexistentes }).toEqual({
        perfil: role.code,
        inexistentes: [],
      });
    }
  });

  it('nenhum perfil tem permissões duplicadas na própria lista', () => {
    for (const role of SYSTEM_ROLES) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('todo parentCode aponta para um perfil existente e sem ciclos', () => {
    for (const role of SYSTEM_ROLES) {
      if (role.parentCode) {
        expect(findSystemRole(role.parentCode)).toBeDefined();
      }
      // resolveEffectivePermissions lança se houver ciclo
      expect(() => resolveEffectivePermissions(role.code)).not.toThrow();
    }
  });

  it('herança funcional: supervisor herda as permissões do operador', () => {
    const operador = resolveEffectivePermissions('OPERADOR_PRODUCAO');
    const supervisor = resolveEffectivePermissions('SUPERVISOR_PRODUCAO');
    for (const p of operador) {
      expect(supervisor).toContain(p);
    }
    expect(supervisor).toContain('production.orders.approve');

    const almoxarife = resolveEffectivePermissions('ALMOXARIFE');
    const supEstoque = resolveEffectivePermissions('SUPERVISOR_ESTOQUE');
    for (const p of almoxarife) {
      expect(supEstoque).toContain(p);
    }

    const vendedor = resolveEffectivePermissions('VENDEDOR');
    const coordenador = resolveEffectivePermissions('COORDENADOR_COMERCIAL');
    for (const p of vendedor) {
      expect(coordenador).toContain(p);
    }
    expect(coordenador).toContain('sales.quotations.approve');
    expect(vendedor).not.toContain('sales.quotations.approve');
  });

  it('mapeamento enum → perfil cobre os 10 roles do enum atual (10/10)', () => {
    const enumValues = Object.values(UserRole);
    expect(enumValues.length).toBe(10);
    for (const value of enumValues) {
      const roleCode = ENUM_ROLE_TO_SYSTEM_ROLE[value];
      expect(roleCode).toBeDefined();
      expect(findSystemRole(roleCode)).toBeDefined();
    }
  });

  it('ADMIN_GLOBAL tem as permissões DE TENANT, menos a elegibilidade de atendimento', () => {
    const admin = findSystemRole('ADMIN_GLOBAL')!;
    // #1002-C3: `crm.leads.assignable` marca quem PODE RECEBER lead. É função
    // operacional, não privilégio — sem esta exclusão o dono da empresa
    // entraria sozinho no rodízio de balcão pela varredura dinâmica.
    expect(admin.permissions).not.toContain('crm.leads.assignable');
    const esperado = tenantPermissionCodes().filter((c) => c !== 'crm.leads.assignable');
    expect(new Set(admin.permissions)).toEqual(new Set(esperado));
  });

  it('ADMIN_EMPRESA tem tudo de tenant exceto as ações globais do sistema', () => {
    const admin = findSystemRole('ADMIN_EMPRESA')!;
    expect(admin.permissions).not.toContain('settings.companies.create');
    expect(admin.permissions).not.toContain('fiscal.tributary-classifications.sync');
    // #947: a capability de escopo empresarial é a terceira exclusão — quem
    // administra UMA empresa não atravessa as outras do grupo.
    expect(admin.permissions).not.toContain('iam.tenant-scope.cross-company');
    // #1002-C3: a quarta exclusão — elegibilidade para receber lead.
    expect(admin.permissions).not.toContain('crm.leads.assignable');
    expect(admin.permissions.length).toBe(tenantPermissionCodes().length - 4);
  });

  // ── #947: os três poderes que saíram do enum legado ────────────────────────
  describe('#947 — poderes críticos migrados do enum para o RBAC v2', () => {
    const CROSS_COMPANY = 'iam.tenant-scope.cross-company';
    const DISCOUNT = 'sales.discount.override';
    const BILLING_BLOCK = 'sales.orders.billing-block-override';

    it('DIRETOR recebe os dois poderes comerciais de exceção', () => {
      const diretor = findSystemRole('DIRETOR')!;
      expect(diretor.permissions).toContain(DISCOUNT);
      expect(diretor.permissions).toContain(BILLING_BLOCK);
    });

    it('DIRETOR NÃO recebe o escopo cross-company', () => {
      expect(findSystemRole('DIRETOR')!.permissions).not.toContain(CROSS_COMPANY);
    });

    it('a capability cross-company é EXCLUSIVA do ADMIN_GLOBAL', () => {
      const comCapability = SYSTEM_ROLES.filter((r) => r.permissions.includes(CROSS_COMPANY)).map(
        (r) => r.code,
      );
      expect(comCapability).toEqual(['ADMIN_GLOBAL']);
    });

    it('AVECCHI_OPERATOR não recebe nenhum dos três por este mecanismo', () => {
      const operador = findSystemRole('AVECCHI_OPERATOR')!;
      expect(operador.permissions).not.toContain(CROSS_COMPANY);
      expect(operador.permissions).not.toContain(DISCOUNT);
      expect(operador.permissions).not.toContain(BILLING_BLOCK);
    });

    it('perfis comerciais NÃO ganham o override de desconto de brinde', () => {
      for (const code of ['GERENTE_GERAL', 'GERENTE_COMERCIAL', 'VENDEDOR', 'COORDENADOR_COMERCIAL']) {
        const role = findSystemRole(code)!;
        expect(role.permissions).not.toContain(DISCOUNT);
        expect(role.permissions).not.toContain(BILLING_BLOCK);
      }
    });

    it('quem CONFIGURA a alçada não é necessariamente quem a ultrapassa', () => {
      // GERENTE_GERAL configura a tabela de tetos, mas não passa por cima dela
      const gerente = findSystemRole('GERENTE_GERAL')!;
      expect(gerente.permissions).toContain('sales.discount-policies.configure');
      expect(gerente.permissions).not.toContain(DISCOUNT);
    });
  });

  // ── OPS WP1 (#908): fronteira do control plane ─────────────────────────────

  it('🔒 NENHUM perfil de tenant tem permissão ops.* (nem por herança) — só AVECCHI_*', () => {
    for (const role of SYSTEM_ROLES) {
      if (role.code.startsWith('AVECCHI_')) continue;
      const efetivas = resolveEffectivePermissions(role.code);
      const vazadas = [...efetivas].filter((p) => p.startsWith('ops.'));
      expect({ perfil: role.code, vazadas }).toEqual({
        perfil: role.code,
        vazadas: [],
      });
    }
  });

  it('AVECCHI_OPERATOR tem exatamente o módulo ops, exige MFA e não herda nada', () => {
    const operator = findSystemRole('AVECCHI_OPERATOR')!;
    expect(operator).toBeDefined();
    expect(new Set(operator.permissions)).toEqual(new Set(moduleCodes('ops')));
    expect(operator.permissions.length).toBeGreaterThan(0);
    expect(operator.requireMfa).toBe(true);
    expect(operator.parentCode).toBeUndefined();
    // Nenhuma permissão intra-tenant: operador da Avecchi não opera o ERP do cliente
    const intraTenant = operator.permissions.filter((p) => !p.startsWith('ops.'));
    expect(intraTenant).toEqual([]);
  });

  it('nenhum enum role aponta para perfil da operadora (espelhamento nunca concede ops.*)', () => {
    for (const roleCode of Object.values(ENUM_ROLE_TO_SYSTEM_ROLE)) {
      expect(roleCode.startsWith('AVECCHI_')).toBe(false);
    }
  });

  it('AUDITOR só tem leitura + export (nenhuma mutação)', () => {
    const auditor = findSystemRole('AUDITOR')!;
    // Exports são LEITURA empacotada (relatório/arquivo), não mutação —
    // #623 (E1) somou management book e ZIP de XMLs fiscais ao auditor.
    const EXPORTS_DE_LEITURA = [
      'analytics.export.execute',
      'finance.reports.export',
      'fiscal.documents.export',
      // #1032: export por recurso — mesma natureza (leitura empacotada em
      // arquivo), agora com code próprio por recurso em vez do genérico.
      'products.catalog.export',
      'customers.registry.export',
      // #1001-C2: `view-all` é LEITURA — amplia o recorte de "só as minhas"
      // para "as de todos", sem conceder nenhuma escrita. O auditor recebe a
      // visão ampla e continua SEM approve e SEM configure (ver c2-1001-matriz).
      'sales.commissions.view-all',
    ];
    const mutacoes = auditor.permissions.filter(
      (p) => !p.endsWith('.view') && !EXPORTS_DE_LEITURA.includes(p),
    );
    expect(mutacoes).toEqual([]);
    // Auditor vê inclusive os módulos sensíveis
    expect(auditor.permissions).toContain('finance.entries.view');
    expect(auditor.permissions).toContain('settings.users.view');
    expect(auditor.permissions).toContain('sales.commissions.view');
    // F5.1 (#341): a trilha de auditoria agora tem code no catálogo
    expect(auditor.permissions).toContain('iam.audit-logs.view');
  });

  it('iam.audit-logs.view só vai para ADMIN_GLOBAL, ADMIN_EMPRESA e AUDITOR (decisão Rafael #341)', () => {
    const temAuditLog = (code: string) =>
      findSystemRole(code)!.permissions.includes('iam.audit-logs.view');
    // Quem PODE ver a trilha de auditoria
    expect(temAuditLog('ADMIN_GLOBAL')).toBe(true);
    expect(temAuditLog('ADMIN_EMPRESA')).toBe(true);
    expect(temAuditLog('AUDITOR')).toBe(true);
    // DIRETOR NÃO vê: logs podem conter dados sensíveis de segurança/operação
    expect(temAuditLog('DIRETOR')).toBe(false);
    // READER também não (já coberto acima, reforço explícito)
    expect(temAuditLog('SOMENTE_LEITURA')).toBe(false);
  });

  it('iam.roles.* segue a matriz da decisão Rafael #352 (view p/ diretoria+auditor; manage/assign só admins)', () => {
    const has = (role: string, code: string) =>
      findSystemRole(role)!.permissions.includes(code);
    // ADMIN_GLOBAL e ADMIN_EMPRESA: gerenciam e atribuem (view + manage + assign)
    for (const role of ['ADMIN_GLOBAL', 'ADMIN_EMPRESA']) {
      expect(has(role, 'iam.roles.view')).toBe(true);
      expect(has(role, 'iam.roles.manage')).toBe(true);
      expect(has(role, 'iam.roles.assign')).toBe(true);
    }
    // DIRETOR: só VISUALIZA — não gerencia perfis nem atribui acessos/exceções
    expect(has('DIRETOR', 'iam.roles.view')).toBe(true);
    expect(has('DIRETOR', 'iam.roles.manage')).toBe(false);
    expect(has('DIRETOR', 'iam.roles.assign')).toBe(false);
    // AUDITOR: só visualiza
    expect(has('AUDITOR', 'iam.roles.view')).toBe(true);
    expect(has('AUDITOR', 'iam.roles.manage')).toBe(false);
    expect(has('AUDITOR', 'iam.roles.assign')).toBe(false);
    // SOMENTE_LEITURA/READER: fora da área de perfis e permissões
    for (const code of ['iam.roles.view', 'iam.roles.manage', 'iam.roles.assign']) {
      expect(has('SOMENTE_LEITURA', code)).toBe(false);
    }
  });

  it('iam.org.* segue a matriz da decisão Rafael #347 fase 1 (estrutura organizacional)', () => {
    // Estrutura organizacional é CADASTRO da empresa (≠ segurança IAM). Por isso
    // o DIRETOR gerencia a estrutura (manage/assign) mesmo sem gerenciar perfis;
    // RH aloca pessoas (assign) sem redesenhar a estrutura (sem manage);
    // ADMIN_FILIAL e AUDITOR só visualizam nesta fase.
    const eff = (role: string) => new Set(resolveEffectivePermissions(role));
    // [view, manage, assign] esperados por perfil
    const MATRIZ: Record<string, [boolean, boolean, boolean]> = {
      ADMIN_GLOBAL: [true, true, true],
      ADMIN_EMPRESA: [true, true, true],
      DIRETOR: [true, true, true],
      RH: [true, false, true],
      ADMIN_FILIAL: [true, false, false],
      AUDITOR: [true, false, false],
      SOMENTE_LEITURA: [false, false, false],
      VISITANTE: [false, false, false],
    };
    for (const [role, [v, m, a]] of Object.entries(MATRIZ)) {
      const p = eff(role);
      expect(p.has('iam.org.view')).toBe(v);
      expect(p.has('iam.org.manage')).toBe(m);
      expect(p.has('iam.org.assign')).toBe(a);
    }
    // Separação org × IAM: DIRETOR gerencia estrutura mas NÃO perfis/permissões.
    const diretor = eff('DIRETOR');
    expect(diretor.has('iam.org.manage')).toBe(true);
    expect(diretor.has('iam.org.assign')).toBe(true);
    expect(diretor.has('iam.roles.manage')).toBe(false);
    expect(diretor.has('iam.roles.assign')).toBe(false);
  });

  it('SOMENTE_LEITURA só tem leitura e NÃO vê módulos sensíveis', () => {
    const leitura = findSystemRole('SOMENTE_LEITURA')!;
    const mutacoes = leitura.permissions.filter((p) => !p.endsWith('.view'));
    expect(mutacoes).toEqual([]);
    for (const sensivel of [
      'finance.entries.view',
      'dashboard.finance.view',
      'sales.commissions.view',
      'settings.users.view',
      'approvals.requests.view',
      'lgpd.consents.view',
      'iam.audit-logs.view',
    ]) {
      expect(leitura.permissions).not.toContain(sensivel);
    }
  });

  it('VISITANTE só vê dashboards operacionais', () => {
    const visitante = findSystemRole('VISITANTE')!;
    expect(visitante.permissions.every((p) => p.startsWith('dashboard.') && p.endsWith('.view'))).toBe(true);
    expect(visitante.permissions).not.toContain('dashboard.finance.view');
  });

  it('segregação de funções: COMPRADOR não aprova pedido de compra', () => {
    const comprador = resolveEffectivePermissions('COMPRADOR');
    expect(comprador).toContain('purchases.orders.create');
    expect(comprador).not.toContain('purchases.orders.approve');
  });

  it('VENDEDOR não fatura (emissão de NF-e é do financeiro/fiscal)', () => {
    const vendedor = resolveEffectivePermissions('VENDEDOR');
    expect(vendedor).toContain('sales.orders.create');
    expect(vendedor).not.toContain('sales.orders.invoice');
    for (const perfilQueFatura of ['FINANCEIRO', 'FISCAL', 'GERENTE_FINANCEIRO']) {
      expect(resolveEffectivePermissions(perfilQueFatura)).toContain('sales.orders.invoice');
    }
  });

  it('Loja em 3 perfis (decisão #463): operação vende sem faturar, faturamento herda e fatura', () => {
    // LOJA_OPERACIONAL: vende e opera, mas NÃO fatura nem cancela/devolve
    const operacional = resolveEffectivePermissions('LOJA_OPERACIONAL');
    expect(operacional).toContain('sales.orders.create');
    expect(operacional).toContain('customers.registry.create');
    expect(operacional).toContain('stock.transfers.create');
    expect(operacional).toContain('purchases.requests.create');
    expect(operacional).not.toContain('sales.orders.invoice');
    expect(operacional).not.toContain('sales.orders.return');
    expect(operacional).not.toContain('sales.orders.cancel');

    // LOJA_FATURAMENTO: herda a operação e acrescenta faturar; sem cancelar NF-e
    const faturamento = resolveEffectivePermissions('LOJA_FATURAMENTO');
    expect(faturamento).toContain('sales.orders.create'); // herdado
    expect(faturamento).toContain('sales.orders.invoice');
    expect(faturamento).not.toContain('fiscal.nfe.cancel');

    // GERENTE_LOJA: herda faturamento + visão gerencial; sem devolução/cancelamento sensível
    const gerente = resolveEffectivePermissions('GERENTE_LOJA');
    expect(gerente).toContain('sales.orders.invoice'); // herdado
    expect(gerente).toContain('sales.commissions.view');
    expect(gerente).not.toContain('sales.orders.return');
    expect(gerente).not.toContain('sales.orders.cancel');
    expect(gerente).not.toContain('fiscal.nfe.cancel');
  });

  it('MANAGER mapeia para GERENTE_GERAL (não GERENTE_INDUSTRIAL); STORE para LOJA_OPERACIONAL', () => {
    expect(ENUM_ROLE_TO_SYSTEM_ROLE.MANAGER).toBe('GERENTE_GERAL');
    expect(ENUM_ROLE_TO_SYSTEM_ROLE.STORE).toBe('LOJA_OPERACIONAL');
    // GERENTE_INDUSTRIAL segue no catálogo como perfil separado (uso real)
    expect(findSystemRole('GERENTE_INDUSTRIAL')).toBeDefined();
  });

  it('GERENTE_GERAL: amplo (vende/fatura, opera compras/estoque/produção, aprova) mas SEM áreas sensíveis', () => {
    const gg = resolveEffectivePermissions('GERENTE_GERAL');
    // Amplitude operacional
    expect(gg).toContain('sales.orders.invoice');
    expect(gg).toContain('purchases.orders.approve');
    expect(gg).toContain('stock.movements.create');
    expect(gg).toContain('production.orders.create');
    expect(gg).toContain('approvals.requests.approve');
    // Financeiro/fiscal: só leitura
    expect(gg).toContain('finance.entries.view');
    expect(gg).toContain('fiscal.documents.view');
    // Áreas sensíveis protegidas
    for (const sensivel of [
      'settings.users.create',
      'finance.bank-accounts.create',
      'fiscal.nfe.cancel',
      'fiscal.tax-rules.create',
      'sales.orders.return',
      'sales.orders.cancel',
    ]) {
      expect(gg).not.toContain(sensivel);
    }
  });

  it('cancelamento de NF-e restrito: só FISCAL e admins', () => {
    // #623 (E2, decisão Rafael): GERENTE_FINANCEIRO perdeu a operação fiscal
    // (eventos NF-e ficam com o perfil FISCAL + admins).
    const podeCancelar = SYSTEM_ROLES.filter((r) =>
      resolveEffectivePermissions(r.code).includes('fiscal.nfe.cancel'),
    ).map((r) => r.code);
    expect(podeCancelar.sort()).toEqual(
      ['ADMIN_GLOBAL', 'ADMIN_EMPRESA', 'FISCAL'].sort(),
    );
  });
});
