import {
  clampPage,
  clampPageSize,
  clampTake,
  DEFAULT_OPTIONS_TAKE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginate,
  withStableTiebreak,
} from './paginate.util';

describe('paginate util (#1028)', () => {
  describe('clampPageSize', () => {
    it('aplica teto de 100 quando o cliente pede mais', () => {
      expect(clampPageSize(500)).toBe(MAX_PAGE_SIZE);
    });

    it('aplica piso de 1 quando o cliente pede menos (ou zero/negativo)', () => {
      expect(clampPageSize(0)).toBe(1);
      expect(clampPageSize(-10)).toBe(1);
    });

    it('usa default 25 quando ausente ou inválido', () => {
      expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
      expect(clampPageSize(null)).toBe(DEFAULT_PAGE_SIZE);
      expect(clampPageSize(NaN)).toBe(DEFAULT_PAGE_SIZE);
    });

    it('trunca valores fracionários', () => {
      expect(clampPageSize(30.7)).toBe(30);
    });
  });

  describe('clampTake (#1028 parte 2 — endpoint de opções)', () => {
    it('aplica o mesmo teto de 100 que clampPageSize', () => {
      expect(clampTake(500)).toBe(MAX_PAGE_SIZE);
    });

    it('aplica piso de 1', () => {
      expect(clampTake(0)).toBe(1);
      expect(clampTake(-10)).toBe(1);
    });

    it('usa default 50 (maior que o de página) quando ausente ou inválido', () => {
      expect(clampTake(undefined)).toBe(DEFAULT_OPTIONS_TAKE);
      expect(clampTake(null)).toBe(DEFAULT_OPTIONS_TAKE);
      expect(clampTake(NaN)).toBe(DEFAULT_OPTIONS_TAKE);
      expect(DEFAULT_OPTIONS_TAKE).toBe(50);
    });

    it('trunca valores fracionários', () => {
      expect(clampTake(30.7)).toBe(30);
    });
  });

  describe('clampPage', () => {
    it('default 1 quando ausente/inválido/abaixo de 1', () => {
      expect(clampPage(undefined)).toBe(1);
      expect(clampPage(0)).toBe(1);
      expect(clampPage(-5)).toBe(1);
      expect(clampPage(NaN)).toBe(1);
    });

    it('preserva página válida', () => {
      expect(clampPage(7)).toBe(7);
    });
  });

  describe('withStableTiebreak', () => {
    it('acrescenta desempate por id quando o chamador só passa createdAt', () => {
      expect(withStableTiebreak({ createdAt: 'desc' })).toEqual([
        { createdAt: 'desc' },
        { id: 'asc' },
      ]);
    });

    it('não duplica quando o chamador já ordena por id', () => {
      expect(withStableTiebreak([{ name: 'asc' }, { id: 'desc' }])).toEqual([
        { name: 'asc' },
        { id: 'desc' },
      ]);
    });

    it('aceita orderBy único não-array e devolve array', () => {
      expect(withStableTiebreak({ id: 'asc' })).toEqual([{ id: 'asc' }]);
    });
  });

  describe('paginate', () => {
    function fakeCalls(total: number, items: unknown[] = []) {
      return {
        count: jest.fn().mockResolvedValue(total),
        findMany: jest.fn().mockResolvedValue(items),
      };
    }

    it('calcula skip a partir de page/pageSize', async () => {
      const { count, findMany } = fakeCalls(100);
      await paginate({ orderBy: { createdAt: 'desc' }, page: 3, pageSize: 10, count, findMany });
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    });

    it('clampa pageSize acima de 100 antes de calcular skip/take', async () => {
      const { count, findMany } = fakeCalls(1000);
      await paginate({ orderBy: { createdAt: 'desc' }, page: 2, pageSize: 500, count, findMany });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: MAX_PAGE_SIZE, take: MAX_PAGE_SIZE }),
      );
    });

    it('clampa pageSize abaixo de 1', async () => {
      const { count, findMany } = fakeCalls(10);
      await paginate({ orderBy: { createdAt: 'desc' }, page: 1, pageSize: 0, count, findMany });
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
    });

    it('usa default 25 e página 1 quando nada é informado', async () => {
      const { count, findMany } = fakeCalls(10);
      const res = await paginate({ orderBy: { createdAt: 'desc' }, count, findMany });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: DEFAULT_PAGE_SIZE }),
      );
      expect(res.page).toBe(1);
      expect(res.pageSize).toBe(DEFAULT_PAGE_SIZE);
    });

    it('aplica o desempate por id no orderBy passado ao findMany', async () => {
      const { count, findMany } = fakeCalls(10);
      await paginate({ orderBy: { createdAt: 'desc' }, count, findMany });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
      );
    });

    it('devolve o envelope { items, total, page, pageSize }', async () => {
      const items = [{ id: '1' }, { id: '2' }];
      const { count, findMany } = fakeCalls(42, items);
      const res = await paginate({ orderBy: { createdAt: 'desc' }, page: 2, pageSize: 25, count, findMany });
      expect(res).toEqual({ items, total: 42, page: 2, pageSize: 25 });
    });

    it('chama count e findMany em paralelo (Promise.all)', async () => {
      const { count, findMany } = fakeCalls(1);
      await paginate({ orderBy: { createdAt: 'desc' }, count, findMany });
      expect(count).toHaveBeenCalledTimes(1);
      expect(findMany).toHaveBeenCalledTimes(1);
    });
  });
});
