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

  it('tem exatamente 25 perfis (24 da issue #339 + Loja, recomendação da arquitetura)', () => {
    expect(SYSTEM_ROLES.length).toBe(25);
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

  it('LOJA (migração 1:1 do STORE) participa de transferências e solicitações', () => {
    const loja = resolveEffectivePermissions('LOJA');
    expect(loja).toContain('stock.transfers.create');
    expect(loja).toContain('purchases.requests.create');
    expect(loja).not.toContain('stock.transfers.cancel');
    expect(loja).not.toContain('sales.orders.create');
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
