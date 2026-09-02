import { AuthController } from './auth.controller';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../common/auth/auth-cookies';

/**
 * Regressão do bug reproduzido em produção em 02/09/2026: com a sessão web
 * migrada para cookie httpOnly (#349), POST /auth/change-password no modo
 * voluntário chegava ao service SEM identidade — o controller repassava
 * apenas `req.headers.authorization`, ignorando `req.cookies.gdr_access`.
 * Resultado: 401 "Não autenticado" e a senha nunca era alterada, apesar de
 * o usuário estar logado.
 *
 * Este spec falha no código anterior (accessToken chegava undefined) e
 * garante o contrato: o controller entrega ao service o access token
 * resolvido pela MESMA regra da JwtStrategy (Bearer > cookie), e nunca o
 * refresh.
 */
describe('AuthController.changePassword — identidade por cookie OU Bearer', () => {
  const authService = { changePassword: jest.fn().mockResolvedValue({ success: true }) };
  const controller = new AuthController(
    authService as any,
    {} as any, // SessionService
    {} as any, // MfaService
    {} as any, // PasswordPolicyService
    {} as any, // PermissionService
    {} as any, // TenantScopeService
  );

  beforeEach(() => authService.changePassword.mockClear());

  it('sessão por COOKIE (sem Authorization) → service recebe o token do cookie', async () => {
    const req = { headers: { 'x-csrf-token': 'csrf' }, cookies: { [ACCESS_COOKIE]: 'tok-cookie' } };
    await controller.changePassword(req, 'atual', 'Nova#Senha123', undefined as any);
    expect(authService.changePassword).toHaveBeenCalledWith({
      accessToken: 'tok-cookie',
      passwordChangeToken: undefined,
      currentPassword: 'atual',
      newPassword: 'Nova#Senha123',
    });
  });

  it('cliente legado com Bearer (sem cookie) → service recebe o token do header', async () => {
    const req = { headers: { authorization: 'Bearer tok-header' }, cookies: {} };
    await controller.changePassword(req, 'atual', 'Nova#Senha123', undefined as any);
    expect(authService.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'tok-header' }),
    );
  });

  it('modo FORCED: passwordChangeToken segue no body, independente de cookie/header', async () => {
    const req = { headers: {}, cookies: {} };
    await controller.changePassword(req, undefined as any, 'Nova#Senha123', 'restrito');
    expect(authService.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: null, passwordChangeToken: 'restrito' }),
    );
  });

  it('só cookie de REFRESH → accessToken null (refresh nunca vale como access)', async () => {
    const req = { headers: {}, cookies: { [REFRESH_COOKIE]: 'tok-refresh' } };
    await controller.changePassword(req, 'atual', 'Nova#Senha123', undefined as any);
    expect(authService.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: null }),
    );
  });
});
