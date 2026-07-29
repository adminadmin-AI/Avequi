import { codigoDoCentro, stepEhDoCentro } from './work-center-ref';

/**
 * #815 — o fallback para o campo textual legado é a parte mais delicada da
 * transição: precisa funcionar para roteiro antigo e NUNCA sobrepor a FK.
 */
describe('work-center-ref (#815)', () => {
  const wc = { id: 'wc-solda', code: 'SET-SOL-002' };

  describe('stepEhDoCentro', () => {
    it('casa pela FK quando ela existe', () => {
      expect(stepEhDoCentro({ workCenterId: 'wc-solda', workCenter: null }, wc)).toBe(true);
    });

    it('não casa quando a FK aponta para outro centro', () => {
      expect(stepEhDoCentro({ workCenterId: 'wc-corte', workCenter: null }, wc)).toBe(false);
    });

    it('FK tem prioridade sobre o texto — texto divergente não confunde', () => {
      // Etapa já migrada, com texto desatualizado apontando para outro código.
      const step = { workCenterId: 'wc-corte', workCenter: 'SET-SOL-002' };
      expect(stepEhDoCentro(step, wc)).toBe(false);
    });

    it('fallback: casa pelo texto quando a FK é nula', () => {
      expect(stepEhDoCentro({ workCenterId: null, workCenter: 'SET-SOL-002' }, wc)).toBe(true);
    });

    it('fallback: texto diferente não casa', () => {
      expect(stepEhDoCentro({ workCenterId: null, workCenter: 'SET-MET-001' }, wc)).toBe(false);
    });

    it('etapa sem centro nenhum não casa', () => {
      expect(stepEhDoCentro({ workCenterId: null, workCenter: null }, wc)).toBe(false);
      expect(stepEhDoCentro({}, wc)).toBe(false);
    });
  });

  describe('codigoDoCentro', () => {
    it('prioriza o code vindo da relação carregada', () => {
      const step = { workCenterId: 'wc-solda', workCenter: 'ANTIGO', workCenterRef: { code: 'SET-SOL-002' } };
      expect(codigoDoCentro(step)).toBe('SET-SOL-002');
    });

    it('cai para o texto legado quando não há relação', () => {
      expect(codigoDoCentro({ workCenterId: null, workCenter: 'SET-MET-001' })).toBe('SET-MET-001');
    });

    it('devolve null quando não há centro definido', () => {
      expect(codigoDoCentro({ workCenterId: null, workCenter: null })).toBeNull();
    });
  });
});
