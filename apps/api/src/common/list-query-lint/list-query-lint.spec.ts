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

/**
 * GATE DO CI — catraca, não zero absoluto.
 *
 * A #1028 corrigiu `product` e `customer`, mas a base tem 174 ofensores em 61
 * arquivos. Um gate que exigisse zero não poderia ser ligado hoje, e gate
 * desligado não protege nada — a versão que pega regressão AGORA vale mais que
 * a versão perfeita que fica em `skip` esperando uma limpeza de semanas.
 *
 * Então o baseline registra a dívida conhecida por ARQUIVO e o gate falha
 * quando ela AUMENTA. Contagem por arquivo, não `arquivo:linha`, de propósito:
 * a linha muda a cada edição sem relação com o lint e produziria falha
 * fantasma em PR que só mexeu em outra coisa.
 *
 * A catraca aperta nos dois sentidos: corrigir um ofensor também falha, com a
 * instrução de baixar o número no baseline. É o mesmo princípio da lista
 * estagnada do route-gate-coverage — sem isso o baseline vira gaveta e daqui a
 * seis meses ninguém sabe se os 174 ainda existem.
 *
 * Zerar a dívida é trabalho próprio (ver #1028 e a lista no PR #1030).
 */
describe('List Query Lint — GATE: a dívida de findMany sem teto não pode crescer', () => {
  const baseline: Record<string, number> = JSON.parse(
    readFileSync(join(__dirname, 'baseline.json'), 'utf8'),
  );

  it('nenhum arquivo ganhou findMany sem teto (e nenhum arquivo novo entrou)', () => {
    const { scannedFiles, offenders } = lintModulesDir(join(__dirname, '../../modules'));
    expect(scannedFiles).toBeGreaterThan(400); // sanidade anti-falso-verde

    const atual: Record<string, number> = {};
    for (const o of offenders) atual[o.file] = (atual[o.file] ?? 0) + 1;

    const regressoes: string[] = [];
    for (const [arquivo, quantos] of Object.entries(atual)) {
      const permitido = baseline[arquivo] ?? 0;
      if (quantos > permitido) {
        const linhas = offenders
          .filter((o) => o.file === arquivo)
          .map((o) => `linha ${o.line} (${o.model})`)
          .join(', ');
        regressoes.push(
          `${arquivo}: ${quantos} ofensor(es), baseline permite ${permitido} — ${linhas}`,
        );
      }
    }

    expect(regressoes).toEqual([]);
  });

  it('baseline não está estagnado: arquivo corrigido tem de sair do baseline', () => {
    const { offenders } = lintModulesDir(join(__dirname, '../../modules'));
    const atual: Record<string, number> = {};
    for (const o of offenders) atual[o.file] = (atual[o.file] ?? 0) + 1;

    const desatualizados: string[] = [];
    for (const [arquivo, permitido] of Object.entries(baseline)) {
      const quantos = atual[arquivo] ?? 0;
      if (quantos < permitido) {
        desatualizados.push(
          quantos === 0
            ? `${arquivo}: resolvido — REMOVA a entrada do baseline.json`
            : `${arquivo}: caiu de ${permitido} para ${quantos} — ATUALIZE o baseline.json`,
        );
      }
    }

    expect(desatualizados).toEqual([]);
  });
});
