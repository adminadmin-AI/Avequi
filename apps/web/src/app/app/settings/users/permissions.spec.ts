import { describe, expect, it } from 'vitest';
import {
  USERS_UPDATE_PERMISSION,
  canShowStatusToggle,
  canShowPasswordReset,
} from './permissions';

/**
 * O toggle Ativo/Inativo da tela de usuários só aparece para quem tem a
 * MESMA permissão que o backend exige no PATCH /users/:id. Este teste trava
 * o code exato — se o backend mudar o gate (user.controller.ts) sem
 * espelhar aqui, a revisão pega pela quebra do literal.
 */
describe('toggle Ativo/Inativo — gate por permissão RBAC v2', () => {
  it('usa exatamente o code que o backend exige no PATCH /users/:id', () => {
    expect(USERS_UPDATE_PERMISSION).toBe('settings.users.update');
  });

  it('com settings.users.update → toggle visível', () => {
    const can = (code: string) => code === 'settings.users.update';
    expect(canShowStatusToggle(can)).toBe(true);
  });

  it('sem a permissão (fail-closed, inclusive carregando) → toggle oculto', () => {
    expect(canShowStatusToggle(() => false)).toBe(false);
  });

  it('outra permissão qualquer não libera', () => {
    const can = (code: string) => code === 'settings.users.view';
    expect(canShowStatusToggle(can)).toBe(false);
  });
});

/**
 * Redefinir senha (#750) chama o MESMO PATCH /users/:id — mesmo gate do
 * toggle. Se o backend ganhar um code dedicado, este bloco força a revisão.
 */
describe('redefinir senha — gate por permissão RBAC v2', () => {
  it('com settings.users.update → ação visível', () => {
    const can = (code: string) => code === 'settings.users.update';
    expect(canShowPasswordReset(can)).toBe(true);
  });

  it('sem a permissão (fail-closed, inclusive carregando) → ação oculta', () => {
    expect(canShowPasswordReset(() => false)).toBe(false);
  });

  it('outra permissão qualquer não libera', () => {
    const can = (code: string) => code === 'settings.users.view';
    expect(canShowPasswordReset(can)).toBe(false);
  });
});
