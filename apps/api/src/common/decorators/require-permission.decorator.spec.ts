import { Reflector } from '@nestjs/core';
import {
  RequirePermission,
  REQUIRE_PERMISSION_KEY,
  assertCatalogPermissionCodes,
} from './require-permission.decorator';
import { allPermissionCodes } from '../../modules/iam/permissions.catalog';

describe('@RequirePermission (#341)', () => {
  const reflector = new Reflector();

  it('registra a metadata com os codes no handler', () => {
    class Dummy {
      @RequirePermission('iam.audit-logs.view')
      handler() {}
    }
    const meta = reflector.get<string[]>(REQUIRE_PERMISSION_KEY, Dummy.prototype.handler);
    expect(meta).toEqual(['iam.audit-logs.view']);
  });

  it('aceita múltiplos codes (semântica AND — o guard exige todos)', () => {
    class Dummy {
      @RequirePermission('finance.entries.pay', 'finance.entries.view')
      handler() {}
    }
    const meta = reflector.get<string[]>(REQUIRE_PERMISSION_KEY, Dummy.prototype.handler);
    expect(meta).toEqual(['finance.entries.pay', 'finance.entries.view']);
  });

  it('pode decorar a classe inteira (metadata no controller)', () => {
    @RequirePermission('iam.audit-logs.view')
    class Dummy {}
    const meta = reflector.get<string[]>(REQUIRE_PERMISSION_KEY, Dummy);
    expect(meta).toEqual(['iam.audit-logs.view']);
  });

  describe('fail-fast contra typo (validação em tempo de decoração = boot)', () => {
    it('lança se o code não existe no catálogo', () => {
      expect(() => RequirePermission('iam.audit-logs.viwe')).toThrow(
        /não existe no catálogo/,
      );
    });

    it('lança sem nenhum code', () => {
      expect(() => RequirePermission()).toThrow(/pelo menos um code/);
    });

    it('lança com code vazio', () => {
      expect(() => RequirePermission('')).toThrow(/vazio ou inválido/);
    });

    it('rejeita wildcard (enforcement de rota deve ser explícito)', () => {
      expect(() => RequirePermission('sales.*')).toThrow(/wildcard/);
      expect(() => RequirePermission('*')).toThrow(/wildcard/);
    });

    it('lança se QUALQUER code da lista for inválido (não só o primeiro)', () => {
      expect(() =>
        RequirePermission('iam.audit-logs.view', 'modulo.que.nao-existe'),
      ).toThrow(/modulo\.que\.nao-existe/);
    });

    it('assertCatalogPermissionCodes aceita todos os codes reais do catálogo', () => {
      expect(() => assertCatalogPermissionCodes(allPermissionCodes())).not.toThrow();
    });
  });
});
