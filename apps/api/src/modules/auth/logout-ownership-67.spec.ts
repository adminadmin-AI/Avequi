import { AuthController } from './auth.controller';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../../common/auth/auth-cookies';

/**
 * #67 — logout é self-service: revoga o refresh token do PRÓPRIO usuário.
 *
 * Este spec cobre o CONTRATO da rota (o que o controller entrega ao service e
 * o que devolve ao browser). A regra de dono em si — `stored.userId` versus o
 * usuário autenticado — é exercitada no `auth.service.spec.ts`.
 *
 * O invariante que mais importa aqui: **os cookies de quem chamou são limpos
 * em TODOS os caminhos**, inclusive quando o token apresentado é de outra
 * pessoa. Mismatch de posse não pode prender ninguém dentro do sistema.
 */
describe('AuthController.logout — #67', () => {
  let controller: AuthController;
  let authService: { logout: jest.Mock };

  const A = { id: 'user-a', role: 'COMMERCIAL', companyId: 'c1' };

  /** Response de mentira: só o que o clearAuthCookies usa. */
  const fakeRes = () => ({ clearCookie: jest.fn(), cookie: jest.fn() });

  /** Request de mentira: só os cookies. */
  const reqCom = (refreshCookie?: string) => ({
    cookies: refreshCookie ? { [REFRESH_COOKIE]: refreshCookie } : {},
  });

  const esperaCookiesLimpos = (res: ReturnType<typeof fakeRes>) => {
    const limpos = res.clearCookie.mock.calls.map((c) => c[0]);
    expect(limpos).toEqual(
      expect.arrayContaining([ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]),
    );
  };

  beforeEach(() => {
    authService = { logout: jest.fn().mockResolvedValue(undefined) };
    controller = new AuthController(
      authService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  describe('identidade do chamador', () => {
    it('passa o id do usuário autenticado para o service', async () => {
      const res = fakeRes();
      await controller.logout(A, reqCom('meu-token'), res as never, undefined);

      expect(authService.logout).toHaveBeenCalledWith('meu-token', A.id);
    });

    it('a identidade vem do JWT, NUNCA do corpo da requisição', async () => {
      // Ainda que o cliente mande um token que não é dele, o segundo argumento
      // continua sendo o usuário autenticado — é o service que decide.
      const res = fakeRes();
      await controller.logout(A, reqCom(), res as never, 'token-de-outra-pessoa');

      expect(authService.logout).toHaveBeenCalledWith('token-de-outra-pessoa', A.id);
    });
  });

  describe('origem do token — contrato preservado (#349)', () => {
    it('sem corpo, usa o cookie httpOnly (fluxo do front atual)', async () => {
      const res = fakeRes();
      await controller.logout(A, reqCom('token-do-cookie'), res as never, undefined);

      expect(authService.logout).toHaveBeenCalledWith('token-do-cookie', A.id);
    });

    it('com corpo, o corpo tem precedência (cliente Bearer legado)', async () => {
      const res = fakeRes();
      await controller.logout(A, reqCom('token-do-cookie'), res as never, 'token-do-body');

      expect(authService.logout).toHaveBeenCalledWith('token-do-body', A.id);
    });

    it('sem corpo e sem cookie, chama o service assim mesmo (no-op lá dentro)', async () => {
      const res = fakeRes();
      await controller.logout(A, reqCom(), res as never, undefined);

      expect(authService.logout).toHaveBeenCalledWith(undefined, A.id);
    });
  });

  describe('cookies do chamador — limpos SEMPRE', () => {
    it('token próprio → cookies limpos', async () => {
      const res = fakeRes();
      await controller.logout(A, reqCom('meu-token'), res as never, undefined);

      esperaCookiesLimpos(res);
    });

    it('token de terceiro → cookies limpos do mesmo jeito', async () => {
      // O service não revoga nada do outro usuário, mas quem pediu logout
      // precisa sair do browser. Mismatch não pode prender ninguém dentro.
      const res = fakeRes();
      await controller.logout(A, reqCom(), res as never, 'token-de-outra-pessoa');

      esperaCookiesLimpos(res);
    });

    it('token inexistente → cookies limpos', async () => {
      const res = fakeRes();
      await controller.logout(A, reqCom('token-que-nao-existe'), res as never, undefined);

      esperaCookiesLimpos(res);
    });

    it('corpo vazio e sem cookie → cookies limpos', async () => {
      const res = fakeRes();
      await controller.logout(A, reqCom(), res as never, undefined);

      esperaCookiesLimpos(res);
    });

    it('cliente legado com token no corpo → cookies limpos', async () => {
      const res = fakeRes();
      await controller.logout(A, reqCom(), res as never, 'token-legado');

      esperaCookiesLimpos(res);
    });
  });

  describe('anti-enumeração e idempotência', () => {
    it('token de terceiro e token inexistente têm a MESMA resposta', async () => {
      const resTerceiro = fakeRes();
      const terceiro = await controller.logout(
        A,
        reqCom(),
        resTerceiro as never,
        'token-de-outra-pessoa',
      );

      const resInexistente = fakeRes();
      const inexistente = await controller.logout(
        A,
        reqCom(),
        resInexistente as never,
        'token-que-nao-existe',
      );

      // Mesmo retorno (204 sem corpo) e mesmos cookies limpos: nada distingue
      // os dois casos para quem está do lado de fora.
      expect(terceiro).toBeUndefined();
      expect(inexistente).toBeUndefined();
      expect(resTerceiro.clearCookie.mock.calls).toEqual(
        resInexistente.clearCookie.mock.calls,
      );
    });

    it('logout repetido não vira erro', async () => {
      const res = fakeRes();
      await expect(
        controller.logout(A, reqCom('meu-token'), res as never, undefined),
      ).resolves.toBeUndefined();
      await expect(
        controller.logout(A, reqCom('meu-token'), res as never, undefined),
      ).resolves.toBeUndefined();
    });
  });
});
