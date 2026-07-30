/**
 * Testes do NÚCLEO GENÉRICO de sincronização de WorkCenter.
 * Dados 100% sintéticos — nenhuma empresa, taxonomia ou código de implantação
 * real aqui. Convenção do repo: nunca banco real; cliente mockado.
 */
import {
  planWorkCenterSync,
  resolveTargetCompany,
  runWorkCenterImport,
  type DesiredWorkCenter,
  type ExistingWorkCenter,
  type WorkCenterImportDb,
} from './work-center-import';

const CNPJ = '11111111000111'; // sintético

const DESIRED: DesiredWorkCenter[] = [
  { code: 'WC-A', name: 'Centro A', description: 'Linha 1 · Interno', isActive: true },
  { code: 'WC-B', name: 'Centro B', description: 'Linha 1 · Externo', isActive: true },
  { code: 'WC-C', name: 'Centro C', description: null, isActive: false },
];

/** Espelho do estado que DESIRED produz no banco (tudo sincronizado). */
function existingFromDesired(desired: DesiredWorkCenter[]): ExistingWorkCenter[] {
  return desired.map((wc, i) => ({ id: `id-${i}`, ...wc }));
}

const COMPANY = { id: 'company-1', cnpj: CNPJ, name: 'Empresa Sintética' };

interface MockDb extends WorkCenterImportDb {
  createSpy: jest.Mock;
  updateSpy: jest.Mock;
  deleteSpy: jest.Mock;
}

function makeDb(companies = [COMPANY], existing: ExistingWorkCenter[] = []): MockDb {
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

const OPTS = { apply: false, deactivateMissing: false, targetCnpj: CNPJ };

describe('planWorkCenterSync — classificação', () => {
  it('base vazia → todos criados', () => {
    const plan = planWorkCenterSync(DESIRED, []);
    expect(plan.create).toHaveLength(DESIRED.length);
    expect(plan.update).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(0);
    expect(plan.missing).toHaveLength(0);
  });

  it('segunda execução lógica → todos inalterados, sem duplicidade', () => {
    const plan = planWorkCenterSync(DESIRED, existingFromDesired(DESIRED));
    expect(plan.unchanged).toHaveLength(DESIRED.length);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });

  it('alteração de nome → somente aquele registro atualizado, só o campo name', () => {
    const existing = existingFromDesired(DESIRED);
    existing[0] = { ...existing[0], name: 'Nome Antigo' };
    const plan = planWorkCenterSync(DESIRED, existing);
    expect(plan.update).toEqual([{ id: 'id-0', code: 'WC-A', changes: { name: 'Centro A' } }]);
    expect(plan.unchanged).toHaveLength(DESIRED.length - 1);
  });

  it('alteração de description (incluindo null → texto) → somente aquele registro', () => {
    const existing = existingFromDesired(DESIRED);
    existing[1] = { ...existing[1], description: null };
    const plan = planWorkCenterSync(DESIRED, existing);
    expect(plan.update).toEqual([{ id: 'id-1', code: 'WC-B', changes: { description: 'Linha 1 · Externo' } }]);
  });

  it('alteração de isActive → somente aquele registro atualizado', () => {
    const existing = existingFromDesired(DESIRED);
    existing[2] = { ...existing[2], isActive: true }; // desejado é false
    const plan = planWorkCenterSync(DESIRED, existing);
    expect(plan.update).toEqual([{ id: 'id-2', code: 'WC-C', changes: { isActive: false } }]);
  });

  it('ausente é classificado e nunca entra em update/create', () => {
    const extra: ExistingWorkCenter = {
      id: 'id-extra', code: 'WC-VELHO', name: 'Centro Extinto', description: null, isActive: true,
    };
    const plan = planWorkCenterSync(DESIRED, [...existingFromDesired(DESIRED), extra]);
    expect(plan.missing).toEqual([extra]);
    expect(plan.missingToDeactivate).toEqual([extra]);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });

  it('ausente já inativo não entra em missingToDeactivate', () => {
    const extra: ExistingWorkCenter = {
      id: 'id-extra', code: 'WC-VELHO', name: 'Centro Extinto', description: null, isActive: false,
    };
    const plan = planWorkCenterSync(DESIRED, [...existingFromDesired(DESIRED), extra]);
    expect(plan.missing).toEqual([extra]);
    expect(plan.missingToDeactivate).toHaveLength(0);
  });

  it('code duplicado no dataset lança erro', () => {
    expect(() => planWorkCenterSync([DESIRED[0], DESIRED[0]], [])).toThrow('code duplicado');
  });
});

describe('resolveTargetCompany — segurança contra empresa errada', () => {
  it('zero resultados aborta com erro claro', () => {
    expect(() => resolveTargetCompany([], '00000000000000')).toThrow('Nenhuma empresa encontrada');
  });

  it('mais de um resultado aborta (nunca escolher a primeira)', () => {
    expect(() =>
      resolveTargetCompany([COMPANY, { id: 'x', cnpj: COMPANY.cnpj, name: 'Empresa Homônima' }], COMPANY.cnpj),
    ).toThrow('ambíguo');
  });

  it('exatamente um resultado prossegue', () => {
    expect(resolveTargetCompany([COMPANY], COMPANY.cnpj)).toBe(COMPANY);
  });
});

describe('runWorkCenterImport — dry-run', () => {
  it('não chama NENHUMA escrita e devolve o plano completo', async () => {
    const db = makeDb([COMPANY], []);
    const result = await runWorkCenterImport(db, DESIRED, OPTS);
    expect(result.applied).toBe(false);
    expect(result.plan.create).toHaveLength(DESIRED.length);
    expect(db.createSpy).not.toHaveBeenCalled();
    expect(db.updateSpy).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('nem com deactivateMissing o dry-run escreve', async () => {
    const extra: ExistingWorkCenter = { id: 'id-x', code: 'WC-X', name: 'X', description: null, isActive: true };
    const db = makeDb([COMPANY], [extra]);
    await runWorkCenterImport(db, DESIRED, { ...OPTS, deactivateMissing: true });
    expect(db.updateSpy).not.toHaveBeenCalled();
  });
});

describe('runWorkCenterImport — apply', () => {
  it('base vazia → cria todos, com companyId da empresa resolvida (nunca do dataset)', async () => {
    const db = makeDb([COMPANY], []);
    const result = await runWorkCenterImport(db, DESIRED, { ...OPTS, apply: true });
    expect(result.created).toBe(DESIRED.length);
    expect(db.createSpy).toHaveBeenCalledTimes(DESIRED.length);
    for (const call of db.createSpy.mock.calls) {
      expect(call[0].data.companyId).toBe(COMPANY.id);
      // criação envia SÓ campos administrados + companyId — os demais campos
      // do WorkCenter ficam nos defaults do schema
      expect(Object.keys(call[0].data).sort()).toEqual(['code', 'companyId', 'description', 'isActive', 'name']);
    }
  });

  it('segunda execução → 0 escritas, tudo inalterado (idempotência)', async () => {
    const db = makeDb([COMPANY], existingFromDesired(DESIRED));
    const result = await runWorkCenterImport(db, DESIRED, { ...OPTS, apply: true });
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.plan.unchanged).toHaveLength(DESIRED.length);
    expect(db.createSpy).not.toHaveBeenCalled();
    expect(db.updateSpy).not.toHaveBeenCalled();
  });

  it('campos operacionais divergentes no banco NÃO geram update (nem são lidos)', async () => {
    // o plano só olha name/description/isActive
    const db = makeDb([COMPANY], existingFromDesired(DESIRED));
    await runWorkCenterImport(db, DESIRED, { ...OPTS, apply: true });
    expect(db.updateSpy).not.toHaveBeenCalled();
  });

  it('update envia somente os campos administrados que mudaram', async () => {
    const existing = existingFromDesired(DESIRED);
    existing[0] = { ...existing[0], name: 'Antigo' };
    const db = makeDb([COMPANY], existing);
    const result = await runWorkCenterImport(db, DESIRED, { ...OPTS, apply: true });
    expect(result.updated).toBe(1);
    expect(db.updateSpy).toHaveBeenCalledTimes(1);
    expect(db.updateSpy).toHaveBeenCalledWith({ where: { id: 'id-0' }, data: { name: 'Centro A' } });
  });

  it('ausente sem flag é apenas relatado — nenhuma escrita sobre ele', async () => {
    const extra: ExistingWorkCenter = { id: 'id-x', code: 'WC-X', name: 'X', description: null, isActive: true };
    const db = makeDb([COMPANY], [...existingFromDesired(DESIRED), extra]);
    const result = await runWorkCenterImport(db, DESIRED, { ...OPTS, apply: true });
    expect(result.plan.missing).toEqual([extra]);
    expect(result.deactivated).toBe(0);
    expect(db.updateSpy).not.toHaveBeenCalled();
  });

  it('ausente com deactivateMissing é desativado, nunca excluído', async () => {
    const extra: ExistingWorkCenter = { id: 'id-x', code: 'WC-X', name: 'X', description: null, isActive: true };
    const db = makeDb([COMPANY], [...existingFromDesired(DESIRED), extra]);
    const result = await runWorkCenterImport(db, DESIRED, { ...OPTS, apply: true, deactivateMissing: true });
    expect(result.deactivated).toBe(1);
    expect(db.updateSpy).toHaveBeenCalledWith({ where: { id: 'id-x' }, data: { isActive: false } });
    expect(db.deleteSpy).not.toHaveBeenCalled(); // não existe caminho de exclusão no importador
  });

  it('escritas acontecem dentro de transação', async () => {
    const db = makeDb([COMPANY], []);
    await runWorkCenterImport(db, DESIRED, { ...OPTS, apply: true });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('CNPJ vazio aborta — o núcleo não tem empresa padrão', async () => {
    const db = makeDb([COMPANY], []);
    await expect(runWorkCenterImport(db, DESIRED, { ...OPTS, targetCnpj: '' })).rejects.toThrow('obrigatório');
    expect(db.company.findMany).not.toHaveBeenCalled();
  });

  it('CNPJ inexistente aborta antes de qualquer leitura/escrita de WorkCenter', async () => {
    const db = makeDb([COMPANY], []);
    await expect(
      runWorkCenterImport(db, DESIRED, { ...OPTS, apply: true, targetCnpj: '99999999999999' }),
    ).rejects.toThrow('Nenhuma empresa encontrada');
    expect(db.workCenter.findMany).not.toHaveBeenCalled();
    expect(db.createSpy).not.toHaveBeenCalled();
  });

  it('CNPJ ambíguo aborta sem escrever', async () => {
    const db = makeDb([COMPANY, { id: 'c2', cnpj: COMPANY.cnpj, name: 'Empresa Homônima' }], []);
    await expect(runWorkCenterImport(db, DESIRED, { ...OPTS, apply: true })).rejects.toThrow('ambíguo');
    expect(db.createSpy).not.toHaveBeenCalled();
  });

  it('busca da empresa usa igualdade exata (where.cnpj plano, sem contains)', async () => {
    const db = makeDb([COMPANY], []);
    await runWorkCenterImport(db, DESIRED, OPTS);
    expect(db.company.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { cnpj: CNPJ } }));
  });
});
