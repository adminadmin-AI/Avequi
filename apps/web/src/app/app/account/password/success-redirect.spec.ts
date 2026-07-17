import { describe, expect, it, vi } from 'vitest';
import {
  VOLUNTARY_SUCCESS_MESSAGE,
  handleVoluntaryPasswordSuccess,
} from './success-redirect';

/**
 * PR do redirect pós-troca voluntária (feedback do smoke v1.15.0): sucesso →
 * toast + volta ao Início com REPLACE (Voltar não pode retornar à tela de
 * troca concluída). O fluxo forçado (/change-password) não usa este helper —
 * o pós-sucesso dele é o login automático, inalterado neste PR.
 */
describe('troca voluntária de senha — pós-sucesso (#736)', () => {
  it('exibe o toast com o aviso de desconexão das outras sessões', () => {
    const toastSuccess = vi.fn();
    handleVoluntaryPasswordSuccess({ toastSuccess, replace: vi.fn() });
    expect(toastSuccess).toHaveBeenCalledWith(VOLUNTARY_SUCCESS_MESSAGE);
    expect(VOLUNTARY_SUCCESS_MESSAGE).toMatch(/outras sessões/);
  });

  it('redireciona ao Início (/app) — e o toast dispara ANTES da navegação', () => {
    const calls: string[] = [];
    handleVoluntaryPasswordSuccess({
      toastSuccess: () => calls.push('toast'),
      replace: (path) => calls.push(`replace:${path}`),
    });
    expect(calls).toEqual(['toast', 'replace:/app']);
  });

  it('usa replace (não push): um único destino, sem histórico da tela concluída', () => {
    const replace = vi.fn();
    handleVoluntaryPasswordSuccess({ toastSuccess: vi.fn(), replace });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/app');
  });
});
