import { detectPrices, isWithinSdrWindow, validatePriceGrounding } from './sdr-guardrails';

describe('SDR guardrails (F4.3 #523) — validação em código', () => {
  describe('detectPrices', () => {
    it('detecta formatos brasileiros de preço', () => {
      expect(detectPrices('O modelo sai R$ 12.500,00 à vista')).toEqual([12500]);
      expect(detectPrices('custa 3500 reais')).toEqual([3500]);
      expect(detectPrices('fica em 12,5 mil')).toEqual([12500]);
      expect(detectPrices('R$9800')).toEqual([9800]);
    });

    it('ignora números que não são preço (quantidade, medida)', () => {
      expect(detectPrices('temos 3 em estoque, suporta 2 jet skis')).toEqual([]);
      expect(detectPrices('prazo de 15 dias úteis')).toEqual([]);
    });
  });

  describe('validatePriceGrounding', () => {
    it('preço citado SEM tool call → violação (IA inventou)', () => {
      const v = validatePriceGrounding('O reboque custa R$ 9.999', []);
      expect(v.ok).toBe(false);
      expect(v.offending).toEqual([9999]);
    });

    it('preço citado igual ao retornado pela tool → ok', () => {
      const v = validatePriceGrounding('Tem sim! Sai R$ 12.500,00', ['12500.00']);
      expect(v.ok).toBe(true);
    });

    it('preço DIFERENTE do da tool → violação (desconto inventado)', () => {
      const v = validatePriceGrounding('Faço por R$ 11.000 pra você', ['12500.00']);
      expect(v.ok).toBe(false);
      expect(v.offending).toEqual([11000]);
    });

    it('resposta sem preço nenhum → sempre ok', () => {
      expect(validatePriceGrounding('Pra quando você precisa?', []).ok).toBe(true);
    });

    it('tolera 1 real de arredondamento de formatação', () => {
      expect(validatePriceGrounding('sai 12.500 reais', ['12500.90']).ok).toBe(true);
    });
  });

  describe('isWithinSdrWindow', () => {
    it('24_7 atende sempre', () => {
      expect(isWithinSdrWindow('24_7', new Date('2026-07-08T14:00:00-03:00'))).toBe(true);
    });

    it('OFF_HOURS: fora do expediente e fim de semana atende; horário comercial não', () => {
      // quarta 14h BRT = expediente → IA não atende
      expect(isWithinSdrWindow('OFF_HOURS', new Date('2026-07-08T14:00:00-03:00'))).toBe(false);
      // quarta 20h BRT = fora do expediente → atende
      expect(isWithinSdrWindow('OFF_HOURS', new Date('2026-07-08T20:00:00-03:00'))).toBe(true);
      // quarta 6h BRT = madrugada → atende
      expect(isWithinSdrWindow('OFF_HOURS', new Date('2026-07-08T06:00:00-03:00'))).toBe(true);
      // sábado 14h BRT = fim de semana → atende
      expect(isWithinSdrWindow('OFF_HOURS', new Date('2026-07-11T14:00:00-03:00'))).toBe(true);
    });
  });
});
