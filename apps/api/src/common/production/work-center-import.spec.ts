/**
 * Testes do importador de centros de trabalho — issue #816.
 * Lógica pura + executor com banco mockado (convenção do repo: nunca banco real).
 */
import {
  buildDescription,
  DEFAULT_TARGET_COMPANY_CNPJ,
  planWorkCenterSync,
  resolveIsActive,
  resolveTargetCompany,
  runWorkCenterImport,
  toDesired,
  type ExistingWorkCenter,
  type WorkCenterImportDb,
} from './work-center-import';
import { WORK_CENTERS_DATA, type WorkCenterSeed } from '../../modules/production/data/work-centers.data';

const SEEDS: WorkCenterSeed[] = [
  { code: 'SET-TST-001', name: 'Corte Teste', group: 'Metalúrgica', type: 'Producao', displayOrder: 1 },
  { code: 'SET-TST-002', name: 'Pintura Teste', group: 'Pintura EPOX', type: 'Opcional', displayOrder: 2 },
  { code: 'SET-TST-003', name: 'Mercado Teste', group: 'Mercados', type: 'Estoque', displayOrder: 3 },
  { code: 'SET-TST-004', name: 'Apoio Teste', group: 'Administrativo', type: 'Apoio', displayOrder: 4 },
];

/** Espelho do estado que os SEEDS produzem no banco (tudo sincronizado). */
function existingFromSeeds(seeds: WorkCenterSeed[]): ExistingWorkCenter[] {
  return seeds.map((s, i) => ({ id: `id-${i}`, ...toDesired(s) }));
}

const GDR = { id: 'company-gdr', cnpj: DEFAULT_TARGET_COMPANY_CNPJ, name: 'GDR Reboques' };

interface MockDb extends WorkCenterImportDb {
  createSpy: jest.Mock;
  updateSpy: jest.Mock;
  deleteSpy: jest.Mock;
}

function makeDb(companies = [GDR], existing: ExistingWorkCenter[] = []): MockDb {
  const createSpy = jest.fn().mockResolvedValue({});
  const updateSpy = jest.fn().mockResolvedValue({});
  const deleteSpy = jest.fn(); // não existe caminho de exclusão — nunca pode ser chamado
  const db: MockDb = {
    createSpy,
    updateSpy,
    deleteSpy,
    company: { findMany: jest.fn(async ({ where }) => companies.filter((c) => c.cnpj === where.cnpj)) },
    workCenter: { findMany: jest.fn(async () => existing), create: createSpy, update: updateSpy },
    $transaction: jest.fn(async (fn: (tx: WorkCenterImportDb) => Promise<unknown>) => fn(db)) as MockDb['$transaction'],
  };
  return db;
}

const OPTS = { apply: false, deactivateMissing: false, targetCnpj: DEFAULT_TARGET_COMPANY_CNPJ };

describe('resolveIsActive — regra de atividade por tipo', () => {
  it('Producao fica ativo', () => expect(resolveIsActive('Producao')).toBe(true));
  it('Opcional fica ativo (Pintura EPOX)', () => expect(resolveIsActive('Opcional')).toBe(true));
  it('Estoque fica inativo', () => expect(resolveIsActive('Estoque')).toBe(false));
  it('Apoio fica inativo', () => expect(resolveIsActive('Apoio')).toBe(false));
  it('tipo desconhecido lança erro', () =>
    expect(() => resolveIsActive('Zumbi' as never)).toThrow('Tipo de setor desconhecido'));
});

describe('planWorkCenterSync — classificação', () => {
  it('base vazia → todos criados', () => {
    const plan = planWorkCenterSync(SEEDS, []);
    expect(plan.create).toHaveLength(SEEDS.length);
    expect(plan.update).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(0);
    expect(plan.missing).toHaveLength(0);
  });

  it('segunda execução lógica → todos inalterados, sem duplicidade', () => {
    const plan = planWorkCenterSync(SEEDS, existingFromSeeds(SEEDS));
    expect(plan.unchanged).toHaveLength(SEEDS.length);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });

  it('alteração de nome → somente aquele registro atualizado, só o campo name', () => {
    const existing = existingFromSeeds(SEEDS);
    existing[0] = { ...existing[0], name: 'Nome Antigo' };
    const plan = planWorkCenterSync(SEEDS, existing);
    expect(plan.update).toEqual([{ id: 'id-0', code: 'SET-TST-001', changes: { name: 'Corte Teste' } }]);
    expect(plan.unchanged).toHaveLength(SEEDS.length - 1);
  });

  it('alteração de description → somente aquele registro atualizado', () => {
    const existing = existingFromSeeds(SEEDS);
    existing[1] = { ...existing[1], description: 'descrição divergente' };
    const plan = planWorkCenterSync(SEEDS, existing);
    expect(plan.update).toEqual([
      { id: 'id-1', code: 'SET-TST-002', changes: { description: 'Pintura EPOX · Opcional' } },
    ]);
  });

  it('alteração de isActive → somente aquele registro atualizado', () => {
    const existing = existingFromSeeds(SEEDS);
    existing[2] = { ...existing[2], isActive: true }; // Estoque deveria ser inativo
    const plan = planWorkCenterSync(SEEDS, existing);
    expect(plan.update).toEqual([{ id: 'id-2', code: 'SET-TST-003', changes: { isActive: false } }]);
  });

  it('ausente é classificado e nunca entra em update/create', () => {
    const extra: ExistingWorkCenter = {
      id: 'id-extra', code: 'SET-VELHO-999', name: 'Setor Extinto', description: null, isActive: true,
    };
    const plan = planWorkCenterSync(SEEDS, [...existingFromSeeds(SEEDS), extra]);
    expect(plan.missing).toEqual([extra]);
    expect(plan.missingToDeactivate).toEqual([extra]);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });

  it('ausente já inativo não entra em missingToDeactivate', () => {
    const extra: ExistingWorkCenter = {
      id: 'id-extra', code: 'SET-VELHO-999', name: 'Setor Extinto', description: null, isActive: false,
    };
    const plan = planWorkCenterSync(SEEDS, [...existingFromSeeds(SEEDS), extra]);
    expect(plan.missing).toEqual([extra]);
    expect(plan.missingToDeactivate).toHaveLength(0);
  });

  it('code duplicado no arquivo lança erro', () => {
    expect(() => planWorkCenterSync([SEEDS[0], SEEDS[0]], [])).toThrow('code duplicado');
  });
});

describe('resolveTargetCompany — segurança contra empresa errada', () => {
  it('zero resultados aborta com erro claro', () => {
    expect(() => resolveTargetCompany([], '00000000000000')).toThrow('Nenhuma empresa encontrada');
  });

  it('mais de um resultado aborta (nunca escolher a primeira)', () => {
    expect(() =>
      resolveTargetCompany([GDR, { id: 'x', cnpj: GDR.cnpj, name: 'GDR Guarapuava' }], GDR.cnpj),
    ).toThrow('ambíguo');
  });

  it('exatamente um resultado prossegue', () => {
    expect(resolveTargetCompany([GDR], GDR.cnpj)).toBe(GDR);
  });
});

describe('runWorkCenterImport — dry-run', () => {
  it('não chama NENHUMA escrita e imprime plano completo', async () => {
    const db = makeDb([GDR], []);
    const result = await runWorkCenterImport(db, SEEDS, OPTS);
    expect(result.applied).toBe(false);
    expect(result.plan.create).toHaveLength(SEEDS.length);
    expect(db.createSpy).not.toHaveBeenCalled();
    expect(db.updateSpy).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('nem com deactivateMissing o dry-run escreve', async () => {
    const extra: ExistingWorkCenter = { id: 'id-x', code: 'SET-X', name: 'X', description: null, isActive: true };
    const db = makeDb([GDR], [extra]);
    await runWorkCenterImport(db, SEEDS, { ...OPTS, deactivateMissing: true });
    expect(db.updateSpy).not.toHaveBeenCalled();
  });
});

describe('runWorkCenterImport — apply', () => {
  it('base vazia → cria todos, com companyId da empresa resolvida (nunca do arquivo)', async () => {
    const db = makeDb([GDR], []);
    const result = await runWorkCenterImport(db, SEEDS, { ...OPTS, apply: true });
    expect(result.created).toBe(SEEDS.length);
    expect(db.createSpy).toHaveBeenCalledTimes(SEEDS.length);
    for (const call of db.createSpy.mock.calls) {
      expect(call[0].data.companyId).toBe(GDR.id);
      // criação envia SÓ campos administrados + companyId — capacidade/custo/
      // operadores/eficiência ficam nos defaults do schema
      expect(Object.keys(call[0].data).sort()).toEqual(['code', 'companyId', 'description', 'isActive', 'name']);
    }
  });

  it('segunda execução → 0 escritas, tudo inalterado (idempotência)', async () => {
    const db = makeDb([GDR], existingFromSeeds(SEEDS));
    const result = await runWorkCenterImport(db, SEEDS, { ...OPTS, apply: true });
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.plan.unchanged).toHaveLength(SEEDS.length);
    expect(db.createSpy).not.toHaveBeenCalled();
    expect(db.updateSpy).not.toHaveBeenCalled();
  });

  it('campos operacionais divergentes no banco NÃO geram update nem são enviados', async () => {
    // o plano só olha name/description/isActive; capacidade/custo/etc nem são lidos
    const existing = existingFromSeeds(SEEDS);
    const db = makeDb([GDR], existing);
    await runWorkCenterImport(db, SEEDS, { ...OPTS, apply: true });
    expect(db.updateSpy).not.toHaveBeenCalled();
  });

  it('update envia somente os campos administrados que mudaram', async () => {
    const existing = existingFromSeeds(SEEDS);
    existing[0] = { ...existing[0], name: 'Antigo' };
    const db = makeDb([GDR], existing);
    const result = await runWorkCenterImport(db, SEEDS, { ...OPTS, apply: true });
    expect(result.updated).toBe(1);
    expect(db.updateSpy).toHaveBeenCalledTimes(1);
    expect(db.updateSpy).toHaveBeenCalledWith({ where: { id: 'id-0' }, data: { name: 'Corte Teste' } });
  });

  it('ausente sem flag é apenas relatado — nenhuma escrita sobre ele', async () => {
    const extra: ExistingWorkCenter = { id: 'id-x', code: 'SET-X', name: 'X', description: null, isActive: true };
    const db = makeDb([GDR], [...existingFromSeeds(SEEDS), extra]);
    const result = await runWorkCenterImport(db, SEEDS, { ...OPTS, apply: true });
    expect(result.plan.missing).toEqual([extra]);
    expect(result.deactivated).toBe(0);
    expect(db.updateSpy).not.toHaveBeenCalled();
  });

  it('ausente com --deactivate-missing é desativado, nunca excluído', async () => {
    const extra: ExistingWorkCenter = { id: 'id-x', code: 'SET-X', name: 'X', description: null, isActive: true };
    const db = makeDb([GDR], [...existingFromSeeds(SEEDS), extra]);
    const result = await runWorkCenterImport(db, SEEDS, { ...OPTS, apply: true, deactivateMissing: true });
    expect(result.deactivated).toBe(1);
    expect(db.updateSpy).toHaveBeenCalledWith({ where: { id: 'id-x' }, data: { isActive: false } });
    expect(db.deleteSpy).not.toHaveBeenCalled(); // não existe caminho de exclusão no importador
  });

  it('escritas acontecem dentro de transação', async () => {
    const db = makeDb([GDR], []);
    await runWorkCenterImport(db, SEEDS, { ...OPTS, apply: true });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('CNPJ inexistente aborta antes de qualquer leitura/escrita de WorkCenter', async () => {
    const db = makeDb([GDR], []);
    await expect(
      runWorkCenterImport(db, SEEDS, { ...OPTS, apply: true, targetCnpj: '99999999999999' }),
    ).rejects.toThrow('Nenhuma empresa encontrada');
    expect(db.workCenter.findMany).not.toHaveBeenCalled();
    expect(db.createSpy).not.toHaveBeenCalled();
  });

  it('CNPJ ambíguo aborta sem escrever', async () => {
    const db = makeDb([GDR, { id: 'g2', cnpj: GDR.cnpj, name: 'GDR Guarapuava' }], []);
    await expect(runWorkCenterImport(db, SEEDS, { ...OPTS, apply: true })).rejects.toThrow('ambíguo');
    expect(db.createSpy).not.toHaveBeenCalled();
  });

  it('busca da empresa usa igualdade exata (where.cnpj plano, sem contains)', async () => {
    const db = makeDb([GDR], []);
    await runWorkCenterImport(db, SEEDS, OPTS);
    expect(db.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cnpj: DEFAULT_TARGET_COMPANY_CNPJ } }),
    );
  });
});

describe('WORK_CENTERS_DATA — arquivo de dados versionado', () => {
  it('contém os 34 setores atuais com codes únicos', () => {
    expect(WORK_CENTERS_DATA).toHaveLength(34);
    expect(new Set(WORK_CENTERS_DATA.map((s) => s.code)).size).toBe(34);
  });

  it('tem exatamente os 11 não produtivos previstos (8 SET-MER-* + ADM + DIR + REF)', () => {
    const inactive = WORK_CENTERS_DATA.filter((s) => !resolveIsActive(s.type)).map((s) => s.code);
    expect(inactive).toHaveLength(11);
    expect(inactive.filter((c) => c.startsWith('SET-MER-'))).toHaveLength(8);
    expect(inactive).toEqual(expect.arrayContaining(['SET-ADM-001', 'SET-DIR-001', 'SET-REF-001']));
  });

  it('SET-EPX-001 (Opcional) permanece ativo', () => {
    const epx = WORK_CENTERS_DATA.find((s) => s.code === 'SET-EPX-001');
    expect(epx?.type).toBe('Opcional');
    expect(resolveIsActive(epx!.type)).toBe(true);
  });

  it('nenhum registro carrega companyId, CNPJ ou credencial', () => {
    for (const s of WORK_CENTERS_DATA) {
      expect(Object.keys(s).sort()).toEqual(['code', 'displayOrder', 'group', 'name', 'type']);
    }
  });

  it('description derivada segue o padrão "Grupo · Tipo"', () => {
    expect(buildDescription({ group: 'Metalúrgica', type: 'Producao' })).toBe('Metalúrgica · Producao');
  });

  it('displayOrder é 1..N sem buracos (espelho da origem)', () => {
    const orders = WORK_CENTERS_DATA.map((s) => s.displayOrder).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: WORK_CENTERS_DATA.length }, (_, i) => i + 1));
  });
});
