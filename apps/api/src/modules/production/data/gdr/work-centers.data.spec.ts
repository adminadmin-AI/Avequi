/**
 * Testes do DATASET da carga GDR — validam o conteúdo do arquivo da GDR e as
 * regras de transformação DESTA implantação. Não são regras universais do ERP:
 * outra empresa terá seu próprio dataset, com sua própria política.
 */
import {
  GDR_COMPANY_CNPJ,
  GDR_WORK_CENTER_SOURCE,
  GDR_WORK_CENTERS,
  gdrBuildDescription,
  gdrResolveIsActive,
} from './work-centers.data';

describe('gdrResolveIsActive — regra de atividade da GDR', () => {
  it('Producao fica ativo', () => expect(gdrResolveIsActive('Producao')).toBe(true));
  it('Opcional fica ativo (Pintura EPOX)', () => expect(gdrResolveIsActive('Opcional')).toBe(true));
  it('Estoque fica inativo', () => expect(gdrResolveIsActive('Estoque')).toBe(false));
  it('Apoio fica inativo', () => expect(gdrResolveIsActive('Apoio')).toBe(false));
  it('tipo desconhecido lança erro', () =>
    expect(() => gdrResolveIsActive('Zumbi' as never)).toThrow('Tipo de setor desconhecido'));
});

describe('GDR_WORK_CENTER_SOURCE — espelho da tabela Setores_Operacionais', () => {
  it('contém os 34 setores atuais com codes únicos', () => {
    expect(GDR_WORK_CENTER_SOURCE).toHaveLength(34);
    expect(new Set(GDR_WORK_CENTER_SOURCE.map((s) => s.code)).size).toBe(34);
  });

  it('displayOrder é 1..34 sem repetição ou lacuna (espelho da origem)', () => {
    const orders = GDR_WORK_CENTER_SOURCE.map((s) => s.displayOrder).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: 34 }, (_, i) => i + 1));
  });

  it('nenhum registro carrega companyId, CNPJ ou campo operacional', () => {
    for (const s of GDR_WORK_CENTER_SOURCE) {
      expect(Object.keys(s).sort()).toEqual(['code', 'displayOrder', 'group', 'name', 'type']);
    }
  });
});

describe('GDR_WORK_CENTERS — estado final derivado para o núcleo', () => {
  it('deriva os 34 no formato genérico { code, name, description, isActive }', () => {
    expect(GDR_WORK_CENTERS).toHaveLength(34);
    for (const wc of GDR_WORK_CENTERS) {
      expect(Object.keys(wc).sort()).toEqual(['code', 'description', 'isActive', 'name']);
    }
  });

  it('tem 23 ativos e 11 inativos', () => {
    expect(GDR_WORK_CENTERS.filter((wc) => wc.isActive)).toHaveLength(23);
    expect(GDR_WORK_CENTERS.filter((wc) => !wc.isActive)).toHaveLength(11);
  });

  it('os 11 inativos são exatamente os 8 SET-MER-* + ADM + DIR + REF', () => {
    const inactive = GDR_WORK_CENTERS.filter((wc) => !wc.isActive).map((wc) => wc.code);
    expect(inactive.filter((c) => c.startsWith('SET-MER-'))).toHaveLength(8);
    expect(inactive).toEqual(expect.arrayContaining(['SET-ADM-001', 'SET-DIR-001', 'SET-REF-001']));
  });

  it('SET-EPX-001 (Opcional) permanece ativo', () => {
    const epx = GDR_WORK_CENTERS.find((wc) => wc.code === 'SET-EPX-001');
    expect(epx?.isActive).toBe(true);
  });

  it('description derivada segue o padrão "Grupo · Tipo"', () => {
    expect(gdrBuildDescription({ group: 'Metalúrgica', type: 'Producao' })).toBe('Metalúrgica · Producao');
    const corte = GDR_WORK_CENTERS.find((wc) => wc.code === 'SET-MET-001');
    expect(corte?.description).toBe('Metalúrgica · Producao');
    const epx = GDR_WORK_CENTERS.find((wc) => wc.code === 'SET-EPX-001');
    expect(epx?.description).toBe('Pintura EPOX · Opcional');
  });
});

describe('GDR_COMPANY_CNPJ — empresa-alvo da implantação', () => {
  it('é o CNPJ da GDR Reboques e vive só no adaptador (não no núcleo)', () => {
    expect(GDR_COMPANY_CNPJ).toBe('46247069000115');
    // O núcleo genérico não exporta nenhuma empresa padrão:
    const core = jest.requireActual('../../../../common/production/work-center-import');
    const exportedValues = Object.values(core).filter((v) => typeof v === 'string');
    expect(exportedValues).not.toContain(GDR_COMPANY_CNPJ);
  });
});
