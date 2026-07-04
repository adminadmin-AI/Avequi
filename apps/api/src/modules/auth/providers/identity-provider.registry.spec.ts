import { BadRequestException } from '@nestjs/common';
import { IdentityProviderType } from '@prisma/client';
import { AuthController } from '../auth.controller';
import { IdentityProviderRegistry } from './identity-provider.registry';
import { LocalIdentityProvider } from './local.identity-provider';
import { IdentityProvider } from './identity-provider.interface';

/**
 * #346 (SSO prep): o registry resolve providers, o LOCAL delega ao
 * AuthService.validateUser (regressão zero no fluxo atual) e o endpoint
 * GET /auth/sso/providers lista só os habilitados.
 */

const mockAuthService = {
  validateUser: jest.fn(),
};

const mockUser = {
  id: 'user-1',
  email: 'admin@gdr.com.br',
  name: 'Admin',
  role: 'SUPER_ADMIN',
  companyId: 'company-1',
  isActive: true,
};

function buildLocal(): LocalIdentityProvider {
  return new LocalIdentityProvider(mockAuthService as any);
}

describe('LocalIdentityProvider (#346)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('está sempre habilitado (método de autenticação base)', () => {
    expect(buildLocal().isEnabled()).toBe(true);
    expect(buildLocal().type).toBe(IdentityProviderType.LOCAL);
  });

  it('delega ao AuthService.validateUser — MESMO fluxo local de hoje (regressão)', async () => {
    mockAuthService.validateUser.mockResolvedValue(mockUser);
    const ctx = { ipAddress: '1.2.3.4', userAgent: 'jest' };

    const result = await buildLocal().validateOrProvision({
      provider: IdentityProviderType.LOCAL,
      email: 'admin@gdr.com.br',
      credentials: { password: 'Admin@123' },
      context: ctx,
    });

    expect(mockAuthService.validateUser).toHaveBeenCalledWith(
      'admin@gdr.com.br',
      'Admin@123',
      ctx,
    );
    expect(result).toEqual(mockUser);
  });

  it('devolve null (401 genérico no chamador) quando o AuthService rejeita', async () => {
    mockAuthService.validateUser.mockResolvedValue(null);
    const result = await buildLocal().validateOrProvision({
      provider: IdentityProviderType.LOCAL,
      email: 'admin@gdr.com.br',
      credentials: { password: 'senha-errada' },
    });
    expect(result).toBeNull();
  });

  it('devolve null sem chamar o AuthService quando faltam credenciais', async () => {
    const result = await buildLocal().validateOrProvision({
      provider: IdentityProviderType.LOCAL,
      email: 'admin@gdr.com.br',
    });
    expect(result).toBeNull();
    expect(mockAuthService.validateUser).not.toHaveBeenCalled();
  });
});

describe('IdentityProviderRegistry (#346)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolve o provider LOCAL registrado no construtor', () => {
    const local = buildLocal();
    const registry = new IdentityProviderRegistry(local);
    expect(registry.resolve(IdentityProviderType.LOCAL)).toBe(local);
  });

  it('rejeita provider não registrado (GOOGLE ainda não existe) com 400', () => {
    const registry = new IdentityProviderRegistry(buildLocal());
    expect(() => registry.resolve(IdentityProviderType.GOOGLE)).toThrow(BadRequestException);
  });

  it('rejeita provider registrado porém DESABILITADO', () => {
    const registry = new IdentityProviderRegistry(buildLocal());
    const disabled: IdentityProvider = {
      type: IdentityProviderType.MICROSOFT,
      displayName: 'Microsoft (desligado)',
      isEnabled: () => false,
      validateOrProvision: jest.fn(),
    };
    registry.register(disabled);
    expect(() => registry.resolve(IdentityProviderType.MICROSOFT)).toThrow(
      BadRequestException,
    );
  });

  it('não permite registrar o mesmo tipo duas vezes', () => {
    const registry = new IdentityProviderRegistry(buildLocal());
    expect(() => registry.register(buildLocal())).toThrow(
      /já registrado/,
    );
  });

  it('listEnabled devolve só LOCAL hoje (contrato de GET /auth/sso/providers)', () => {
    const registry = new IdentityProviderRegistry(buildLocal());
    const disabled: IdentityProvider = {
      type: IdentityProviderType.SAML,
      displayName: 'SAML (desligado)',
      isEnabled: () => false,
      validateOrProvision: jest.fn(),
    };
    registry.register(disabled);

    expect(registry.listEnabled()).toEqual([
      { type: IdentityProviderType.LOCAL, name: 'E-mail e senha' },
    ]);
  });
});

describe('GET /auth/sso/providers (#346)', () => {
  it('devolve os providers habilitados (só LOCAL hoje) + estado do JIT', () => {
    const registry = new IdentityProviderRegistry(buildLocal());
    const jit = { isJitEnabled: jest.fn().mockReturnValue(false) };
    const controller = new AuthController(
      {} as any, // AuthService — não usado neste endpoint
      {} as any, // SessionService
      {} as any, // MfaService
      {} as any, // PasswordPolicyService
      registry,
      jit as any,
    );

    expect(controller.listSsoProviders()).toEqual({
      providers: [{ type: IdentityProviderType.LOCAL, name: 'E-mail e senha' }],
      jitProvisioning: false,
    });
  });
});
