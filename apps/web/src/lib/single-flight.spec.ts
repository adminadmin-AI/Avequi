import { describe, expect, it, vi } from 'vitest';
import { singleFlight } from './single-flight';

describe('singleFlight', () => {
  it('N chamadas simultâneas executam UMA vez e recebem o mesmo resultado', async () => {
    // É o cenário real: o access expira e todas as queries da tela levam 401
    // no mesmo instante. Sem isto, cada uma dispararia um refresh e a rotação
    // do backend invalidaria as demais → logout.
    const fn = vi.fn(async () => 'novo-token');
    const guardada = singleFlight(fn);

    const resultados = await Promise.all([guardada(), guardada(), guardada(), guardada()]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(resultados).toEqual(['novo-token', 'novo-token', 'novo-token', 'novo-token']);
  });

  it('depois de terminar, uma nova chamada executa de novo (a próxima expiração)', async () => {
    const fn = vi.fn(async () => 'ok');
    const guardada = singleFlight(fn);

    await guardada();
    await guardada();

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('falha não fica grudada: a tentativa seguinte executa de novo', async () => {
    let tentativa = 0;
    const fn = vi.fn(async () => {
      tentativa += 1;
      if (tentativa === 1) throw new Error('rede fora');
      return 'ok';
    });
    const guardada = singleFlight(fn);

    await expect(guardada()).rejects.toThrow('rede fora');
    await expect(guardada()).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('quem entra durante uma execução que FALHA recebe a mesma falha', async () => {
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error('401');
    });
    const guardada = singleFlight(fn);

    const [a, b] = await Promise.allSettled([guardada(), guardada()]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
  });
});
