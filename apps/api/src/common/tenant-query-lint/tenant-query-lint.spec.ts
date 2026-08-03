import { readFileSync } from 'fs';
import { join } from 'path';
import {
  lintDtoSource,
  lintModulesDir,
  lintSource,
  parseTenantModels,
} from './tenant-query-lint';

/**
 * Tenant Query Lint — OPS WP7 (#914), evolução da #158. GATE DE CI:
 * este spec roda a análise estática sobre TODO o src/modules e falha o merge
 * se nascer uma query Prisma multi-tenant sem noção de tenant.
 *
 * As fixtures reproduzem os incidentes históricos (#36, #63, #216/#218 e a
 * classe do #158) — o critério de aceite do WP7 é ZERO falso-negativo nelas.
 */

const FIXTURES = join(__dirname, 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

// Modelos multi-tenant do MUNDO das fixtures ('plan' fica fora de propósito —
// modelo global). O codebase real usa o schema.prisma de verdade.
const MODELOS = new Set(['customer', 'user', 'product', 'report']);

describe('Tenant Query Lint — fixtures dos incidentes (zero falso-negativo)', () => {
  it('#36: listagem/count/groupBy sem filtro de tenant → 3 offenders', () => {
    const off = lintSource(
      fixture('incidente-36-query-aberta.ts.fixture'),
      'incidente-36.ts',
      MODELOS,
    );
    expect(off.map((o) => `${o.model}.${o.op}`).sort()).toEqual([
      'customer.count',
      'customer.findMany',
      'product.groupBy',
    ]);
  });

  it('#63: update/delete por id em método sem noção de tenant → 2 offenders', () => {
    const off = lintSource(
      fixture('incidente-63-update-por-id.ts.fixture'),
      'incidente-63.ts',
      MODELOS,
    );
    expect(off.map((o) => `${o.model}.${o.op}`).sort()).toEqual([
      'user.delete',
      'user.update',
    ]);
  });

  it('#216/#218: findUnique/findMany abertos (RLS teatro) → 2 offenders', () => {
    const off = lintSource(
      fixture('incidente-216-218-findone-aberto.ts.fixture'),
      'incidente-216.ts',
      MODELOS,
    );
    expect(off.map((o) => `${o.model}.${o.op}`).sort()).toEqual([
      'report.findMany',
      'report.findUnique',
    ]);
  });

  it('#158 (DTOs): companyId/tenantId como propriedade → 2 offenders; comentário NÃO flagra', () => {
    const off = lintDtoSource(
      fixture('incidente-158-dto-companyid.ts.fixture'),
      'incidente-158.dto.ts',
    );
    expect(off.map((o) => o.op).sort()).toEqual(['companyId', 'tenantId']);
  });

  it('padrões corretos da casa → ZERO falso-positivo (inclui waiver justificado)', () => {
    const off = lintSource(
      fixture('padroes-corretos.ts.fixture'),
      'padroes-corretos.ts',
      MODELOS,
    );
    expect(off).toEqual([]);
  });
});

describe('Tenant Query Lint — schema real', () => {
  const schema = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const modelos = parseTenantModels(schema);

  it('descobre um volume plausível de modelos multi-tenant no schema.prisma', () => {
    // Regra do produto: "todo dado é isolado por companyId" — se isto
    // despencar, o parser quebrou e o lint estaria varrendo quase nada.
    expect(modelos.size).toBeGreaterThan(40);
    for (const esperado of ['customer', 'product', 'salesOrder', 'fiscalDocument', 'lead']) {
      expect(modelos.has(esperado)).toBe(true);
    }
  });

  it('modelos globais (sem companyId direto) ficam fora do escopo', () => {
    expect(modelos.has('plan')).toBe(false);
  });
});

describe('Tenant Query Lint — GATE: codebase real sem query órfã de tenant', () => {
  it('src/modules inteiro (fora ops/) → zero offenders', () => {
    const { scannedFiles, offenders } = lintModulesDir(join(__dirname, '../../modules'));
    expect(scannedFiles).toBeGreaterThan(400); // sanidade anti-falso-verde
    // Falhou aqui? Ou a query ganha filtro de tenant (companyId no where /
    // chave composta / fetch-então-confere), ou — se for exceção legítima
    // (cron de sistema, plumbing de auth, fronteira própria) — recebe
    // `// tenant-lint: ok (<motivo>)` na linha de cima, revisado como toda
    // exceção de segurança.
    expect(
      offenders.map((o) => `${o.file}:${o.line} ${o.model}.${o.op} [${o.tier}]`),
    ).toEqual([]);
  });
});
