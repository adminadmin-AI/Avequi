import { describe, expect, it } from 'vitest';
import { Package } from 'lucide-react';
import {
  NAV,
  checkRouteAccess,
  flatNav,
  navItemAllowed,
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
  it('nenhum item declara permission E roles ao mesmo tempo (permission substitui)', () => {
    const both = NAV.flatMap((s) => s.items).filter((i) => i.permission && i.roles);
    expect(both.map((i) => i.href)).toEqual([]);
  });

  it('permission codes seguem o formato modulo.recurso.acao', () => {
    const bad = NAV.flatMap((s) => s.items)
      .filter((i) => i.permission)
      .filter((i) => !/^[a-z-]+\.[a-z-]+\.[a-z-]+$/.test(i.permission!));
    expect(bad.map((i) => i.href)).toEqual([]);
  });
});
