import { buildInitialTaxRules } from './tax-rule-seed';

describe('buildInitialTaxRules (#1071)', () => {
  it('CRT=1 → semeia as operações de saída do Simples', () => {
    const rules = buildInitialTaxRules('comp-1', 1);
    expect(rules).toHaveLength(6);
    expect(rules.map((r) => r.operationType)).toEqual([
      'VENDA_INTERNA',
      'VENDA_INTERESTADUAL',
      'DEVOLUCAO_VENDA',
      'TRANSFERENCIA_INTERNA',
      'TRANSFERENCIA_INTERESTADUAL',
      'BONIFICACAO',
    ]);
    expect(rules.every((r) => r.companyId === 'comp-1')).toBe(true);
  });

  // A trava do desenho: ativo por engano = nota emitida com tributação não revisada
  it('toda regra semeada nasce INATIVA', () => {
    expect(buildInitialTaxRules('comp-1', 1).every((r) => r.isActive === false)).toBe(true);
  });

  it('CRT=2 (excesso de sublimite) recebe o mesmo conjunto', () => {
    expect(buildInitialTaxRules('comp-1', 2)).toHaveLength(6);
  });

  it('CRT=3 não semeia nada — regime normal tem variância demais p/ padrão seguro', () => {
    expect(buildInitialTaxRules('comp-1', 3)).toEqual([]);
  });

  it('CRT ausente ou nulo não semeia nada', () => {
    expect(buildInitialTaxRules('comp-1')).toEqual([]);
    expect(buildInitialTaxRules('comp-1', null)).toEqual([]);
  });

  it('padrão conservador: CSOSN 102, sem crédito e sem destaque de federal', () => {
    const venda = buildInitialTaxRules('comp-1', 1)[0];
    expect(venda.icmsCsosn).toBe('102');
    expect(venda.pCredSN).toBeUndefined(); // 102 não permite crédito
    expect(Number(venda.icmsAliquota)).toBe(0);
    expect(venda.ipiCst).toBe('53');
    expect(venda.pisCst).toBe('49');
    expect(venda.cofinsCst).toBe('49');
  });

  it('descrição marca que a regra pede revisão do contador', () => {
    expect(buildInitialTaxRules('comp-1', 1).every((r) => r.description?.startsWith('[REVISAR]'))).toBe(true);
  });
});
