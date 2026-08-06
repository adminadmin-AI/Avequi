import { readFileSync } from 'fs';
import { join } from 'path';
import { CADASTRO_EXCEPTIONS, lintModulesDir, lintSource, parseHighVolumeModels } from './list-query-lint';

/**
 * List Query Lint — PERF #1028. GATE DE CI (quando ligado — ver bloco final):
 * roda a análise estática sobre TODO o src/modules e falha o merge se nascer
 * um `findMany` sobre modelo de alto volume sem `take` nem cursor.
 *
 * As fixtures reproduzem os achados que motivam a issue (product/customer
 * pré-correção) como regressão — critério de aceite: ZERO falso-negativo.
 */

const FIXTURES = join(__dirname, 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

// Mundo das fixtures: 'product' e 'customer' alto volume; 'costCenter' fica
// de fora de propósito (simula um modelo de cadastro/configuração).
const HIGH_VOLUME = new Set(['product', 'customer']);

describe('List Query Lint — fixtures dos achados da #1028 (zero falso-negativo)', () => {
  it('product.service.ts:70 (achado da #1028): findMany sem take/select → 1 offender', () => {
    const off = lintSource(
      fixture('product-service-sem-take.ts.fixture'),
      'product.service.ts',
      HIGH_VOLUME,
    );
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({ model: 'product' });
  });

  it('customer.service.ts:90 (achado da #1028, com include aninhado de tags) → 1 offender', () => {
    const off = lintSource(
      fixture('customer-service-sem-take.ts.fixture'),
      'customer.service.ts',
      HIGH_VOLUME,
    );
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({ model: 'customer' });
  });

  it('padrões corretos (take, cursor, waiver justificado, modelo de cadastro) → ZERO falso-positivo', () => {
    const off = lintSource(
      fixture('padroes-corretos.ts.fixture'),
      'padroes-corretos.ts',
      HIGH_VOLUME, // 'costCenter' não está no set — comportamento igual ao de produção
    );
    expect(off).toEqual([]);
  });

  // Regressão da revisão da #1028: o matcher original era textual sobre os
  // argumentos e aprovava os dois primeiros casos abaixo — falso-negativo
  // exatamente na classe de query que o lint existe para pegar.
  it('teto aninhado em relação e "take:" dentro de string NÃO valem como paginação → 3 offenders', () => {
    const off = lintSource(
      fixture('teto-aninhado-nao-vale.ts.fixture'),
      'teto-aninhado.ts',
      new Set(['product', 'customer', 'salesOrder']),
    );
    expect(off).toHaveLength(3);
    expect(off.map((o) => o.model)).toEqual(['product', 'customer', 'salesOrder']);
  });

  it('waiver sem motivo (sem parênteses, parênteses vazios, ou só espaço) → continua reprovando', () => {
    const off = lintSource(
      fixture('waiver-sem-motivo.ts.fixture'),
      'waiver-sem-motivo.ts',
      HIGH_VOLUME,
    );
    expect(off).toHaveLength(3);
    expect(off.map((o) => o.model)).toEqual(['product', 'customer', 'product']);
  });
});

describe('List Query Lint — schema real', () => {
  const schema = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const modelos = parseHighVolumeModels(schema);

  it('descobre um volume plausível de modelos de alto volume no schema.prisma', () => {
    expect(modelos.size).toBeGreaterThan(50);
  });

  it('Product e Customer contam como alto volume (requisito explícito da #1028)', () => {
    expect(modelos.has('product')).toBe(true);
    expect(modelos.has('customer')).toBe(true);
  });

  it('cadastro/configuração comprovadamente pequeno fica fora (amostra da CADASTRO_EXCEPTIONS)', () => {
    for (const modelo of ['costCenter', 'taxRule', 'role', 'branch', 'workCenter', 'user']) {
      expect(modelos.has(modelo)).toBe(false);
    }
  });

  it('toda entrada de CADASTRO_EXCEPTIONS tem justificativa não-vazia', () => {
    for (const [, motivo] of Object.entries(CADASTRO_EXCEPTIONS)) {
      expect(motivo.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('List Query Lint — GATE: codebase real sem findMany aberto em modelo de alto volume', () => {
  // ⚠️ DESLIGADO DE PROPÓSITO — outro executor está corrigindo product/customer
  // em paralelo (#1028); ligar este gate agora quebraria o CI na main antes
  // dessa correção estar mergeada. Trocar `it.skip` por `it` quando a #1028
  // fechar (product/customer paginados + demais ofensores tratados — ver
  // lista completa no corpo do PR que introduziu este arquivo).
  it.skip('src/modules inteiro → zero offenders', () => {
    const { scannedFiles, offenders } = lintModulesDir(join(__dirname, '../../modules'));
    expect(scannedFiles).toBeGreaterThan(400); // sanidade anti-falso-verde
    expect(offenders.map((o) => `${o.file}:${o.line} ${o.model}.findMany`)).toEqual([]);
  });
});
