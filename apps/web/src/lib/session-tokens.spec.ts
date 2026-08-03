import { describe, expect, it } from 'vitest';
import { tokensParaPersistir } from './session-tokens';

/**
 * Regressão do bug que derrubava a sessão a cada ~30 minutos: a renovação
 * guardava só o accessToken e descartava o refreshToken novo. Como o backend
 * rotaciona (revoga o antigo a cada uso), sobrava no navegador um token
 * morto — e a renovação seguinte jogava o usuário no login.
 */
describe('tokensParaPersistir', () => {
  it('guarda os DOIS tokens da resposta — o refresh JAMAIS pode ser descartado', () => {
    expect(tokensParaPersistir({ accessToken: 'A2', refreshToken: 'R2' })).toEqual({
      accessToken: 'A2',
      refreshToken: 'R2',
    });
  });

  it('resposta só com access não inventa refresh (nem apaga o existente)', () => {
    expect(tokensParaPersistir({ accessToken: 'A2' })).toEqual({ accessToken: 'A2' });
  });

  it('ignora vazio, espaço e não-string — nunca grava lixo no storage', () => {
    expect(tokensParaPersistir({ accessToken: '', refreshToken: '   ' })).toEqual({});
    expect(tokensParaPersistir({ accessToken: undefined, refreshToken: null })).toEqual({});
    expect(tokensParaPersistir({ accessToken: 123, refreshToken: { a: 1 } })).toEqual({});
    expect(tokensParaPersistir(null)).toEqual({});
    expect(tokensParaPersistir(undefined)).toEqual({});
  });
});
