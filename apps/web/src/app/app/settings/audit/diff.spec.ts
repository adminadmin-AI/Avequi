import { describe, expect, it } from 'vitest';
import { diffLegivel, nomeDaAcao, nomeDaEntidade, valorLegivel } from './diff';

describe('valorLegivel', () => {
  it('primitivos viram texto humano', () => {
    expect(valorLegivel(null)).toBe('(vazio)');
    expect(valorLegivel('')).toBe('(vazio)');
    expect(valorLegivel(true)).toBe('Sim');
    expect(valorLegivel(false)).toBe('Não');
    expect(valorLegivel(42)).toBe('42');
    expect(valorLegivel('Solda 2')).toBe('Solda 2');
  });

  it('data ISO fica curta', () => {
    expect(valorLegivel('2026-08-11T14:03:22.000Z')).toBe('11/08/2026 14:03');
  });

  it('objeto e lista viram resumo compacto, sem cara de JSON', () => {
    expect(valorLegivel({ quantity: 2, sku: 'ABC-1' })).toBe('quantidade: 2, SKU: ABC-1');
    expect(valorLegivel([{ a: 1 }, { a: 2 }])).toBe('a: 1; a: 2');
    expect(valorLegivel([])).toBe('(lista vazia)');
  });
});

describe('diffLegivel', () => {
  it('criação (antes null): campos em português, ids resolvidos', () => {
    // O exemplo REAL que o Rafael viu na tela (despacho auditado).
    const resolver = (campo: string, id: string) =>
      campo === 'productId' && id === 'f76e7282' ? 'MOD-CAR-006 · Carga 2,50m' : null;
    const d = diffLegivel(null, { items: [{ quantity: 2, productId: 'f76e7282' }] }, resolver);
    expect(d.tipo).toBe('criado');
    expect(d.campos).toEqual([
      { campo: 'itens', antes: null, depois: 'quantidade: 2, produto: MOD-CAR-006 · Carga 2,50m' },
    ]);
  });

  it('sem resolvedor, o id aparece encurtado e o campo traduzido', () => {
    const d = diffLegivel(null, { productId: 'ccdbb5c5-2646-4403-953e-79797a1a41b6' });
    expect(d.campos).toEqual([{ campo: 'produto', antes: null, depois: 'ccdbb5c5…' }]);
  });

  it('dicionários de ação e entidade traduzem e degradam', () => {
    expect(nomeDaAcao('CREATE')).toBe('Criação');
    expect(nomeDaAcao('DESCONHECIDA')).toBe('DESCONHECIDA');
    expect(nomeDaEntidade('Product')).toBe('Produto');
    expect(nomeDaEntidade('AlgoNovo')).toBe('AlgoNovo');
  });

  it('remoção (depois null): lista os campos do antes', () => {
    const d = diffLegivel({ name: 'Peça X', isActive: true }, null);
    expect(d.tipo).toBe('removido');
    expect(d.campos).toHaveLength(2);
    expect(d.campos[0]).toEqual({ campo: 'nome', antes: 'Peça X', depois: null });
  });

  it('alteração: mostra SÓ os campos que mudaram', () => {
    const d = diffLegivel(
      { name: 'Solda 1', isActive: true, code: 'SET-SOL-002' },
      { name: 'Solda 1', isActive: false, code: 'SET-SOL-002' },
    );
    expect(d.tipo).toBe('alterado');
    expect(d.campos).toEqual([{ campo: 'ativo', antes: 'Sim', depois: 'Não' }]);
  });

  it('campo que só existe de um lado aparece como mudança', () => {
    const d = diffLegivel({ a: 1 }, { a: 1, b: 'novo' });
    expect(d.campos).toEqual([{ campo: 'b', antes: '(vazio)', depois: 'novo' }]);
  });

  it('diff vazio e diff escalar não explodem', () => {
    expect(diffLegivel(null, null).tipo).toBe('vazio');
    const d = diffLegivel(null, 'texto solto');
    expect(d.tipo).toBe('criado');
    expect(d.campos[0].depois).toBe('texto solto');
  });
});
