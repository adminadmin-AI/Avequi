import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IdentityProviderType, UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SsoJitProvisioningService } from './sso-jit-provisioning.service';

/**
 * #346 (SSO prep): JIT provisioning DESLIGADO por default não cria usuário;
 * ligado, cria com perfil default configurável (SUPER_ADMIN proibido) e
 * vínculo em gdr_user_identities; identidade já vinculada e auto-link por
 * e-mail funcionam independentemente do JIT.
 */

// Mock do Prisma ATUALIZADO com o novo model userIdentity (gdr_user_identities).
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  userIdentity: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

const envDefaults: Record<string, unknown> = {
  SSO_JIT_PROVISIONING: false,
  SSO_JIT_DEFAULT_ROLE: 'READER',
};
let env: Record<string, unknown>;

const mockConfig = {
  get: jest.fn((key: string) => env[key]),
};

const googleProfile = {
  provider: IdentityProviderType.GOOGLE,
  providerUserId: 'google-sub-123',
  email: 'novo@gdr.com.br',
  name: 'Novo Usuário',
  metadata: { picture: 'https://foto' },
};

const dbUser = {
  id: 'user-1',
  name: 'Usuário Existente',
  email: 'novo@gdr.com.br',
  passwordHash: '$2a$10$hash',
  role: 'COMMERCIAL',
  companyId: 'company-1',
  isActive: true,
};

describe('SsoJitProvisioningService (#346)', () => {
  let service: SsoJitProvisioningService;

  beforeEach(async () => {
    jest.clearAllMocks();
    env = { ...envDefaults };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SsoJitProvisioningService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(SsoJitProvisioningService);
  });

  it('LOCAL nunca passa pelo JIT (erro de programação, não de usuário)', async () => {
    await expect(
      service.resolveOrProvision({
        provider: IdentityProviderType.LOCAL,
        email: 'a@b.c',
      }),
    ).rejects.toThrow(/não se aplica ao provider LOCAL/);
  });

  it('identidade já vinculada → devolve o usuário SEM passwordHash', async () => {
    mockPrisma.userIdentity.findUnique.mockResolvedValue({
      id: 'ident-1',
      user: dbUser,
    });

    const result = await service.resolveOrProvision(googleProfile);

    expect(result).toMatchObject({ id: 'user-1', email: 'novo@gdr.com.br' });
    expect(result).not.toHaveProperty('passwordHash');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('identidade vinculada a usuário INATIVO → null (401 genérico)', async () => {
    mockPrisma.userIdentity.findUnique.mockResolvedValue({
      id: 'ident-1',
      user: { ...dbUser, isActive: false },
    });
    expect(await service.resolveOrProvision(googleProfile)).toBeNull();
  });

  it('usuário existente com o mesmo e-mail → cria o vínculo (auto-link) e devolve', async () => {
    mockPrisma.userIdentity.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(dbUser);

    const result = await service.resolveOrProvision(googleProfile);

    expect(mockPrisma.userIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        provider: IdentityProviderType.GOOGLE,
        providerUserId: 'google-sub-123',
        email: 'novo@gdr.com.br',
      }),
    });
    expect(result).toMatchObject({ id: 'user-1' });
    expect(result).not.toHaveProperty('passwordHash');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('JIT DESLIGADO (default) + usuário novo → NÃO cria usuário e devolve null', async () => {
    mockPrisma.userIdentity.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await service.resolveOrProvision(googleProfile);

    expect(result).toBeNull();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.userIdentity.create).not.toHaveBeenCalled();
  });

  it('JIT LIGADO → cria usuário com perfil default, senha inutilizável e vínculo', async () => {
    env.SSO_JIT_PROVISIONING = true;
    env.SSO_JIT_DEFAULT_ROLE = 'COMMERCIAL';
    env.SSO_JIT_DEFAULT_COMPANY_ID = 'company-1';
    mockPrisma.userIdentity.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockImplementation(async ({ data }: any) => ({
      id: 'user-novo',
      ...data,
      identities: undefined,
      isActive: true,
    }));

    const result = await service.resolveOrProvision(googleProfile);

    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    const createArgs = mockPrisma.user.create.mock.calls[0][0].data;
    expect(createArgs.role).toBe('COMMERCIAL');
    expect(createArgs.companyId).toBe('company-1');
    expect(createArgs.name).toBe('Novo Usuário');
    // Senha aleatória inutilizável: hash bcrypt presente, nunca a senha crua.
    expect(createArgs.passwordHash).toMatch(/^\$2[aby]\$/);
    // Vínculo criado junto (nested create em gdr_user_identities).
    expect(createArgs.identities.create).toMatchObject({
      provider: IdentityProviderType.GOOGLE,
      providerUserId: 'google-sub-123',
    });
    expect(result).toMatchObject({ id: 'user-novo', role: 'COMMERCIAL' });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('JIT LIGADO sem SSO_JIT_DEFAULT_COMPANY_ID → aborta sem criar', async () => {
    env.SSO_JIT_PROVISIONING = true;
    mockPrisma.userIdentity.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);

    expect(await service.resolveOrProvision(googleProfile)).toBeNull();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN como perfil default é PROIBIDO → cai para READER', () => {
    env.SSO_JIT_DEFAULT_ROLE = 'SUPER_ADMIN';
    expect(service.getDefaultRole()).toBe(UserRole.READER);
    env.SSO_JIT_DEFAULT_ROLE = 'perfil-invalido';
    expect(service.getDefaultRole()).toBe(UserRole.READER);
    env.SSO_JIT_DEFAULT_ROLE = 'FINANCIAL';
    expect(service.getDefaultRole()).toBe(UserRole.FINANCIAL);
  });

  it('perfil sem providerUserId (claim sub ausente) → null, nada criado', async () => {
    const result = await service.resolveOrProvision({
      provider: IdentityProviderType.GOOGLE,
      email: 'novo@gdr.com.br',
    });
    expect(result).toBeNull();
    expect(mockPrisma.userIdentity.findUnique).not.toHaveBeenCalled();
  });
});
