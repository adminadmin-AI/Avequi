import { describe, it, expect } from 'vitest';
import { canEditEntry, isEditableStatus } from './editable';

describe('gate de edição de Contas a Pagar', () => {
  it('perfil autorizado + OPEN → botão visível', () => {
    expect(canEditEntry('OPEN', true)).toBe(true);
  });

  it('perfil autorizado + OVERDUE → botão visível', () => {
    expect(canEditEntry('OVERDUE', true)).toBe(true);
  });

  it('perfil autorizado + PAID/CANCELLED/PARTIALLY_PAID → oculto', () => {
    expect(canEditEntry('PAID', true)).toBe(false);
    expect(canEditEntry('CANCELLED', true)).toBe(false);
    expect(canEditEntry('PARTIALLY_PAID', true)).toBe(false);
  });

  it('perfil SEM permissão + OPEN → oculto (nem com status editável aparece)', () => {
    expect(canEditEntry('OPEN', false)).toBe(false);
    expect(canEditEntry('OVERDUE', false)).toBe(false);
  });

  it('isEditableStatus cobre só OPEN/OVERDUE', () => {
    expect(isEditableStatus('OPEN')).toBe(true);
    expect(isEditableStatus('OVERDUE')).toBe(true);
    expect(isEditableStatus('PAID')).toBe(false);
  });
});
