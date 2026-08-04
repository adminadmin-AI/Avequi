import { describe, expect, it } from 'vitest';
import { Package } from 'lucide-react';
import {
  NAV,
  OPS_NAV,
  buildBreadcrumbs,
  checkRouteAccess,
  flatNav,
  navItemAllowed,
  resolveActiveHref,
  type NavAccess,
  type NavItem,
} from './nav-config';

const canAll: NavAccess = { role: 'READER', can: () => true };
const canNone: NavAccess = { role: 'READER', can: () => false };
const loading: NavAccess = { role: 'READER', can: undefined };

const item = (over: Partial<NavItem>): NavItem => ({
  href: '/app/x',
  label: 'X',
  icon: Package,
  ...over,
});

describe('navItemAllowed (#351)', () => {
  it('item com permission usa can() e ignora roles', () => {
    const it_ = item({ permission: 'sales.orders.view', roles: ['SUPER_ADMIN'] });
    expect(navItemAllowed(it_, canAll)).toBe(true);
    // READER não está em roles, mas a permissão decide
    expect(navItemAllowed(it_, canNone)).toBe(false);
  });

  it('permissões carregando → item com permission fica oculto (fail-closed)', () => {
    expect(navItemAllowed(item({ permission: 'sales.orders.view' }), loading)).toBe(false);
  });

  it('item legado por roles segue funcionando (inclusive durante loading)', () => {
    const it_ = item({ roles: ['SUPER_ADMIN', 'READER'] });
    expect(navItemAllowed(it_, loading)).toBe(true);
    expect(navItemAllowed(it_, { role: 'STORE' })).toBe(false);
    expect(navItemAllowed(it_, { role: undefined })).toBe(false);
  });

  it('item sem permission e sem roles é liberado', () => {
    expect(navItemAllowed(item({}), loading)).toBe(true);
    expect(navItemAllowed(item({}), { role: undefined })).toBe(true);
  });
});

describe('navItemAllowed com entitlement (OPS WP4 #911)', () => {
  it('item com entitlement e a conta SEM esse entitlement → oculto, mesmo com permissão liberada', () => {
    const it_ = item({ permission: 'crm.leads.list', entitlement: 'crm' });
    expect(
      navItemAllowed(it_, { role: 'READER', can: () => true, hasEntitlement: () => false }),
    ).toBe(false);
  });

  it('item com entitlement e a conta COM esse entitlement → visível (permissão também ok)', () => {
    const it_ = item({ permission: 'crm.leads.list', entitlement: 'crm' });
    expect(
      navItemAllowed(it_, { role: 'READER', can: () => true, hasEntitlement: () => true }),
    ).toBe(true);
  });

  it('sem hasEntitlement no access (dado ainda não carregado) → oculto (fail-closed)', () => {
    const it_ = item({ permission: 'crm.leads.list', entitlement: 'crm' });
    expect(navItemAllowed(it_, { role: 'READER', can: () => true })).toBe(false);
  });

  it('conta legado libera o entitlement (hasEntitlement retorna true para qualquer key)', () => {
    const it_ = item({ entitlement: 'crm' });
    expect(navItemAllowed(it_, { role: 'READER', hasEntitlement: () => true })).toBe(true);
  });

  it('item sem campo entitlement → comportamento inalterado, mesmo com hasEntitlement negando tudo', () => {
    const it_ = item({ permission: 'sales.orders.view' });
    expect(
      navItemAllowed(it_, { role: 'READER', can: () => true, hasEntitlement: () => false }),
    ).toBe(true);
    // item livre (sem permission/roles/entitlement) segue liberado
    expect(navItemAllowed(item({}), { role: 'READER', hasEntitlement: () => false })).toBe(true);
  });
});

describe('checkRouteAccess (#351)', () => {
  it('rota com permission: allowed/denied conforme can()', () => {
    expect(checkRouteAccess('/app/sales', canAll)).toEqual({ status: 'allowed' });
    expect(checkRouteAccess('/app/sales', canNone)).toEqual({
      status: 'denied',
      roles: [],
      permission: 'sales.orders.view',
    });
  });

  it('rota com permission durante carregamento → loading (segura render)', () => {
    expect(checkRouteAccess('/app/sales', loading)).toEqual({ status: 'loading' });
  });

  it('sub-rota herda a permission do item pai mais específico', () => {
    // /app/sales/123 → item /app/sales (sales.orders.view)
    expect(checkRouteAccess('/app/sales/123', canNone)).toMatchObject({
      status: 'denied',
      permission: 'sales.orders.view',
    });
    // /app/sales/counter tem item próprio (sales.orders.create)
    expect(checkRouteAccess('/app/sales/counter', canNone)).toMatchObject({
      permission: 'sales.orders.create',
    });
  });

  it('rotas do CRM agora filtram por permissão (Bloco F #624 — fim do roles legado)', () => {
    expect(checkRouteAccess('/app/crm/leads', canAll)).toEqual({ status: 'allowed' });
    expect(checkRouteAccess('/app/crm/leads', canNone)).toMatchObject({
      status: 'denied',
      permission: 'crm.leads.list',
    });
    // fail-closed enquanto as permissões carregam — mesmo para MANAGER
    expect(checkRouteAccess('/app/crm/leads', { role: 'MANAGER', can: undefined })).toEqual({
      status: 'loading',
    });
    expect(checkRouteAccess('/app/crm/inbox', canNone)).toMatchObject({
      status: 'denied',
      permission: 'crm.conversations.view',
    });
  });

  it('rotas do Bloco G agora filtram por permissão (#694/#696 follow-up)', () => {
    expect(checkRouteAccess('/app/shipping', canNone)).toMatchObject({
      status: 'denied',
      permission: 'sales.deliveries.view',
    });
    expect(checkRouteAccess('/app/settings/users', canAll)).toEqual({ status: 'allowed' });
    expect(checkRouteAccess('/app/stock/wms', loading)).toEqual({ status: 'loading' });
  });

  it('rota não mapeada → unmapped (guard libera)', () => {
    expect(checkRouteAccess('/app/nao-existe', canNone)).toEqual({ status: 'unmapped' });
  });
});

describe('flatNav (#351)', () => {
  it('sem can(): só itens livres (nenhum item legado por roles restou — Bloco F)', () => {
    const hrefs = flatNav({ role: 'SUPER_ADMIN' }).map((i) => i.href);
    expect(hrefs).toContain('/app'); // livre
    expect(hrefs).not.toContain('/app/crm/leads'); // Bloco F: agora permission
    expect(hrefs).not.toContain('/app/crm/inbox'); // Bloco F: agora permission
    expect(hrefs).not.toContain('/app/sales'); // permission, sem can()
    expect(hrefs).not.toContain('/app/settings/users'); // Bloco G: agora permission
  });

  it('com can() liberando tudo: inclui os itens com permission', () => {
    const hrefs = flatNav(canAll).map((i) => i.href);
    expect(hrefs).toContain('/app/sales');
    expect(hrefs).toContain('/app/finance/receivables');
  });
});

describe('consistência do NAV', () => {
  const allItems = [...NAV, ...OPS_NAV].flatMap((s) => s.items);

  it('nenhum item declara permission E roles ao mesmo tempo (permission substitui)', () => {
    const both = allItems.filter((i) => i.permission && i.roles);
    expect(both.map((i) => i.href)).toEqual([]);
  });

  it('permission codes seguem o formato modulo.recurso.acao', () => {
    const bad = allItems
      .filter((i) => i.permission)
      .filter((i) => !/^[a-z-]+\.[a-z-]+\.[a-z-]+$/.test(i.permission!));
    expect(bad.map((i) => i.href)).toEqual([]);
  });
});

describe('console da operadora (OPS F2)', () => {
  const opsHrefs = OPS_NAV.flatMap((s) => s.items).map((i) => i.href);

  it('o NAV do ERP guarda só a porta de entrada do console', () => {
    const erpOps = NAV.flatMap((s) => s.items).filter((i) => i.href.startsWith('/app/ops'));
    expect(erpOps.map((i) => i.href)).toEqual(['/app/ops']);
    expect(erpOps[0].permission).toBe('ops.tenants.view');
  });

  it('o console lista as 5 rotas da operadora, painel primeiro (#957)', () => {
    expect(opsHrefs).toEqual([
      '/app/ops',
      '/app/ops/tenants',
      '/app/ops/new',
      '/app/ops/plans',
      '/app/ops/billing',
    ]);
  });

  it('a home do console é o Painel e a lista de contas mora em /app/ops/tenants (#957)', () => {
    const byHref = new Map(OPS_NAV.flatMap((s) => s.items).map((i) => [i.href, i]));
    expect(byHref.get('/app/ops')?.label).toBe('Painel');
    expect(byHref.get('/app/ops/tenants')?.label).toBe('Contas de cliente');
    // as duas metades do painel: a rota exige tenants.view; o financeiro se
    // gateia dentro da página por ops.billing.view
    expect(byHref.get('/app/ops')?.permission).toBe('ops.tenants.view');
    expect(byHref.get('/app/ops/tenants')?.permission).toBe('ops.tenants.view');
  });

  it('as rotas ops continuam guardadas com o gate de cada uma (RouteGuard)', () => {
    // sair do menu do ERP não pode afrouxar o guard — cada rota mantém a
    // SUA permissão, não a herança de /app/ops
    const only = (code: string): NavAccess => ({ role: 'SUPER_ADMIN', can: (c) => c === code });

    expect(checkRouteAccess('/app/ops', only('ops.tenants.view'))).toEqual({ status: 'allowed' });
    expect(checkRouteAccess('/app/ops/plans', only('ops.tenants.view'))).toMatchObject({
      status: 'denied',
      permission: 'ops.plans.view',
    });
    expect(checkRouteAccess('/app/ops/billing', only('ops.tenants.view'))).toMatchObject({
      status: 'denied',
      permission: 'ops.billing.view',
    });
    expect(checkRouteAccess('/app/ops/new', only('ops.tenants.view'))).toMatchObject({
      status: 'denied',
      permission: 'ops.tenants.provision',
    });
    expect(checkRouteAccess('/app/ops/plans', only('ops.plans.view'))).toEqual({
      status: 'allowed',
    });
    // detalhe da conta herda o item pai (/app/ops)
    expect(checkRouteAccess('/app/ops/abc123', canNone)).toMatchObject({
      status: 'denied',
      permission: 'ops.tenants.view',
    });
    // #957: a lista mudou de casa e continua coberta pelo mapa de rotas
    expect(checkRouteAccess('/app/ops/tenants', only('ops.tenants.view'))).toEqual({
      status: 'allowed',
    });
    expect(checkRouteAccess('/app/ops/tenants', only('ops.billing.view'))).toMatchObject({
      status: 'denied',
      permission: 'ops.tenants.view',
    });
    // fail-closed enquanto as permissões carregam
    expect(checkRouteAccess('/app/ops/billing', loading)).toEqual({ status: 'loading' });
    expect(checkRouteAccess('/app/ops/tenants', loading)).toEqual({ status: 'loading' });
  });

  it('o item /app/ops/tenants não sequestra o detalhe de conta (#957)', () => {
    // ids não são o literal "tenants"; e o prefixo só casa com barra
    expect(resolveActiveHref('/app/ops/tenants')).toBe('/app/ops/tenants');
    expect(resolveActiveHref('/app/ops/tenantsXYZ')).toBe('/app/ops');
    expect(resolveActiveHref('/app/ops/clx000000000000000000000')).toBe('/app/ops');
  });

  it('quem não tem ops.tenants.view não vê nada da operadora no menu', () => {
    expect(flatNav(canNone).map((i) => i.href).filter((h) => h.startsWith('/app/ops'))).toEqual([]);
  });

  it('/app/ops aparece uma única vez no flatNav (palette não duplica a porta e a home)', () => {
    const hrefs = flatNav(canAll).map((i) => i.href).filter((h) => h === '/app/ops');
    expect(hrefs).toHaveLength(1);
  });

  it('o item ativo do console resolve pela rota mais específica', () => {
    expect(resolveActiveHref('/app/ops/plans')).toBe('/app/ops/plans');
    expect(resolveActiveHref('/app/ops/abc123')).toBe('/app/ops');
  });

  it('breadcrumbs das rotas do console não quebram', () => {
    expect(buildBreadcrumbs('/app/ops/new').map((c) => c.label)).toEqual([
      'Início',
      'Portal Avecchi',
      'Nova conta',
    ]);
    // #957: o segmento novo tem rótulo pt-BR próprio (não vira "Tenants")
    expect(buildBreadcrumbs('/app/ops/tenants').map((c) => c.label)).toEqual([
      'Início',
      'Portal Avecchi',
      'Contas de cliente',
    ]);
  });
});
