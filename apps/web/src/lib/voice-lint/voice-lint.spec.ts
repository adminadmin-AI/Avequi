import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checarDiretorios, checarSource } from './voice-lint';

/**
 * Voice Lint (#987, Onda 4) — o gate que transforma as Ondas 1-3 em regressão
 * permanente: string de UI nova com termo banido quebra o CI.
 */

// ─── Motor: fixtures ─────────────────────────────────────────────────────────

describe('voice-lint: motor (fixtures)', () => {
  it('flagra travessão em prosa, mas aceita o glifo de valor vazio e a meia-risca', () => {
    expect(checarSource(`const a = 'Taxa ativa — MDR 2,5%';`)).toHaveLength(1);
    expect(checarSource(`const a = '—';`)).toHaveLength(0);
    expect(checarSource(`const indent = '— ';`)).toHaveLength(0);
    expect(checarSource(`const a = 'seg–sex, 8h–18h';`)).toHaveLength(0);
  });

  it('flagra jargão e frases de máquina em prosa', () => {
    expect(checarSource(`toast.error('Não foi possível executar a ação');`)).toHaveLength(1);
    expect(checarSource(`const b = 'O backend ainda não devolve o PDF';`)).toHaveLength(1);
    expect(checarSource(`const b = 'Falha no kill switch';`)).toHaveLength(1);
    expect(checarSource(`const b = 'pendências (#496)';`)).toHaveLength(1);
    expect(checarSource(`toast.success('Status atualizado');`)).toHaveLength(1);
  });

  it('flagra vocabulário aposentado do glossário', () => {
    expect(checarSource(`const t = 'Carteira de Pagáveis';`)).toHaveLength(1);
    expect(checarSource(`const t = 'Nova Ordem de Venda';`)).toHaveLength(1);
    expect(checarSource(`const t = \`OV #\${id}\`;`)).toHaveLength(1);
    expect(checarSource(`const t = 'Lead time (dias)';`)).toHaveLength(1);
    expect(checarSource(`const ok = 'Pedido de venda criado';`)).toHaveLength(0);
  });

  it('string sem espaço: só rótulo exato banido; paths e classes passam', () => {
    expect(checarSource(`const t = 'Dashboard';`)).toHaveLength(1);
    expect(checarSource(`const r = '/app/crm/dashboard';`)).toHaveLength(0);
    expect(checarSource(`const k = 'budget-plans';`)).toHaveLength(0);
    expect(checarSource(`const c = 'flex h-full items-center';`)).toHaveLength(0);
  });

  it('template literal é checado com os trechos estáticos', () => {
    expect(checarSource('const t = `Baixa registrada — título #${id}`;')).toHaveLength(1);
    expect(checarSource('const t = `Baixa registrada no título #${id}`;')).toHaveLength(0);
  });

  it('console.* é ignorado (log de dev, não é UI)', () => {
    expect(checarSource(`console.warn('rota sem item no nav — endpoint x');`)).toHaveLength(0);
  });

  it('waiver na linha ou na linha acima suprime, sempre com motivo', () => {
    expect(
      checarSource(`const t = 'endpoint de teste'; // voice-lint: ok (doc interna de dev)`),
    ).toHaveLength(0);
    expect(
      checarSource(`// voice-lint: ok (fixture)\nconst t = 'endpoint de teste';`),
    ).toHaveLength(0);
    expect(checarSource(`// voice-lint: ok\nconst t = 'endpoint de teste';`)).toHaveLength(1);
  });

  it('JSX text é checado', () => {
    expect(checarSource(`const x = <p>Entregas pós-NF-e — pendências</p>;`)).toHaveLength(1);
    expect(checarSource(`const x = <p>Entregas e pendências</p>;`)).toHaveLength(0);
  });
});

// ─── Gate: o app inteiro está limpo ──────────────────────────────────────────

describe('voice-lint: gate do app (#987)', () => {
  it('🔒 nenhuma string de UI com termo banido em src/app e src/components', () => {
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const ofensores = checarDiretorios([join(raiz, 'app'), join(raiz, 'components')], raiz);
    // Falhou? A mensagem mostra arquivo:linha, o trecho e o motivo — corrija o
    // texto pelo glossário da skill avecchi-voice ou, em exceção consciente,
    // use `// voice-lint: ok (<motivo>)` na linha.
    expect(ofensores).toEqual([]);
  });
});
