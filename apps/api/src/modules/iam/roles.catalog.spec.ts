import { UserRole } from '@prisma/client';
import { allPermissionCodes } from './permissions.catalog';
import {
  SYSTEM_ROLES,
  ENUM_ROLE_TO_SYSTEM_ROLE,
  findSystemRole,
  resolveEffectivePermissions,
} from './roles.catalog';

describe('Catálogo de perfis system (#339)', () => {
  const catalogo = new Set(allPermissionCodes());

  it('tem exatamente 28 perfis (24 da #339 + split de Loja em 3 + Gerente Geral, decisão #463)', () => {
    expect(SYSTEM_ROLES.length).toBe(28);
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

  it('ADMIN_GLOBAL tem TODAS as permissões do catálogo', () => {
    const admin = findSystemRole('ADMIN_GLOBAL')!;
    expect(new Set(admin.permissions)).toEqual(catalogo);
  });

  it('ADMIN_EMPRESA tem tudo exceto as ações globais do sistema', () => {
    const admin = findSystemRole('ADMIN_EMPRESA')!;
    expect(admin.permissions).not.toContain('settings.companies.create');
    expect(admin.permissions).not.toContain('fiscal.tributary-classifications.sync');
    expect(admin.permissions.length).toBe(allPermissionCodes().length - 2);
  });

  it('AUDITOR só tem leitura + export (nenhuma mutação)', () => {
    const auditor = findSystemRole('AUDITOR')!;
    const mutacoes = auditor.permissions.filter(
      (p) => !p.endsWith('.view') && p !== 'analytics.export.execute',
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

  it('cancelamento de NF-e restrito: só perfis fiscais/financeiros elevados', () => {
    const podeCancelar = SYSTEM_ROLES.filter((r) =>
      resolveEffectivePermissions(r.code).includes('fiscal.nfe.cancel'),
    ).map((r) => r.code);
    expect(podeCancelar.sort()).toEqual(
      ['ADMIN_GLOBAL', 'ADMIN_EMPRESA', 'FISCAL', 'GERENTE_FINANCEIRO'].sort(),
    );
  });
});
