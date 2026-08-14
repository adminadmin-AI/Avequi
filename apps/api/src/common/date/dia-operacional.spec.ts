import {
  DataOperacional,
  FUSO_OPERACIONAL,
  comoDataOperacional,
  dataOperacionalHoje,
  formatarDataPura,
  formatarInstante,
  instanteFimDoDia,
  instanteInicioDoDia,
  limiteDeDataPura,
  somarDias,
} from './dia-operacional';

/**
 * #901 — o dia operacional não pode virar às 21h.
 *
 * Todos os testes congelam o relógio: o bug original só aparece na janela entre
 * 21h e meia-noite de São Paulo, que em UTC já é o dia seguinte.
 */
describe('dia operacional (#901)', () => {
  const d = (s: string) => comoDataOperacional(s);

  afterEach(() => jest.useRealTimers());

  const congelar = (iso: string) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(iso));
  };

  describe('a virada do dia', () => {
    it('20:59 em São Paulo ainda é hoje', () => {
      congelar('2026-08-14T23:59:00.000Z'); // 20:59 BRT
      expect(dataOperacionalHoje()).toBe('2026-08-14');
    });

    it('21:01 em São Paulo AINDA é hoje — o bug original', () => {
      congelar('2026-08-15T00:01:00.000Z'); // 21:01 BRT de 14/08
      expect(dataOperacionalHoje()).toBe('2026-08-14');
    });

    it('23:59 em São Paulo ainda é hoje', () => {
      congelar('2026-08-15T02:59:00.000Z');
      expect(dataOperacionalHoje()).toBe('2026-08-14');
    });

    it('00:01 em São Paulo já é o dia seguinte', () => {
      congelar('2026-08-15T03:01:00.000Z');
      expect(dataOperacionalHoje()).toBe('2026-08-15');
    });
  });

  describe('viradas de mês e de ano', () => {
    it('31/08 às 21:30 BRT continua em agosto', () => {
      congelar('2026-09-01T00:30:00.000Z');
      expect(dataOperacionalHoje()).toBe('2026-08-31');
    });

    it('01/09 às 00:30 BRT já é setembro', () => {
      congelar('2026-09-01T03:30:00.000Z');
      expect(dataOperacionalHoje()).toBe('2026-09-01');
    });

    it('31/12 às 22:00 BRT continua em 2026', () => {
      congelar('2027-01-01T01:00:00.000Z');
      expect(dataOperacionalHoje()).toBe('2026-12-31');
    });

    it('01/01 às 00:30 BRT já é 2027', () => {
      congelar('2027-01-01T03:30:00.000Z');
      expect(dataOperacionalHoje()).toBe('2027-01-01');
    });
  });

  it('não depende do fuso do processo', () => {
    const instante = new Date('2026-08-15T01:30:00.000Z'); // 22:30 BRT de 14/08
    const original = process.env.TZ;
    const resultados: string[] = [];
    for (const tz of ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      resultados.push(dataOperacionalHoje(instante));
    }
    process.env.TZ = original;
    expect(new Set(resultados)).toEqual(new Set(['2026-08-14']));
  });

  describe('data pura × instante — a distinção que evita o bug', () => {
    it('limiteDeDataPura devolve a representação canônica, não a meia-noite física', () => {
      expect(limiteDeDataPura(d('2026-08-14')).toISOString()).toBe('2026-08-14T00:00:00.000Z');
    });

    it('instanteInicioDoDia devolve a meia-noite REAL de São Paulo', () => {
      expect(instanteInicioDoDia(d('2026-08-14')).toISOString()).toBe('2026-08-14T03:00:00.000Z');
    });

    it('os dois conceitos são diferentes — comparar um pelo outro é o bug', () => {
      const venceHoje = limiteDeDataPura(d('2026-08-14'));
      // Contra o limite de data pura: NÃO está vencido. Correto.
      expect(venceHoje < limiteDeDataPura(d('2026-08-14'))).toBe(false);
      // Contra o instante físico: pareceria vencido o dia inteiro. Errado.
      expect(venceHoje < instanteInicioDoDia(d('2026-08-14'))).toBe(true);
    });

    it('instanteFimDoDia fecha no último milissegundo do dia brasileiro', () => {
      expect(instanteFimDoDia(d('2026-08-14')).toISOString()).toBe('2026-08-15T02:59:59.999Z');
    });
  });

  describe('formatação', () => {
    it('data pura é lida em UTC — formatar no fuso devolveria o dia anterior', () => {
      const persistida = new Date('2026-08-14T00:00:00.000Z');
      expect(formatarDataPura(persistida)).toBe('2026-08-14');
      expect(formatarInstante(persistida)).toBe('2026-08-13'); // por isso são funções distintas
    });

    it('instante é lido no fuso da operação', () => {
      expect(formatarInstante(new Date('2026-08-15T01:00:00.000Z'))).toBe('2026-08-14');
    });
  });

  describe('somarDias', () => {
    it('atravessa mês', () => {
      expect(somarDias(d('2026-08-20'), 30)).toBe('2026-09-19');
    });

    it('atravessa ano', () => {
      expect(somarDias(d('2026-12-20'), 30)).toBe('2027-01-19');
    });

    it('aceita valor negativo', () => {
      expect(somarDias(d('2026-01-01'), -1)).toBe('2025-12-31');
    });

    it('resultado continua sendo data pura canônica', () => {
      expect(limiteDeDataPura(somarDias(d('2026-08-14'), 30)).toISOString()).toBe(
        '2026-09-13T00:00:00.000Z',
      );
    });
  });

  it('recusa string fora do formato de data', () => {
    expect(() => comoDataOperacional('14/08/2026')).toThrow(/Data operacional inválida/);
    expect(() => comoDataOperacional('2026-08-14T00:00:00Z')).toThrow(/Data operacional inválida/);
  });

  it('o fuso da operação é único e centralizado', () => {
    expect(FUSO_OPERACIONAL).toBe('America/Sao_Paulo');
  });

  it('tipagem: DataOperacional não é string solta', () => {
    const data: DataOperacional = d('2026-08-14');
    expect(typeof data).toBe('string');
  });
});
