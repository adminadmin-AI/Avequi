import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';

const mockUserService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  getUiPreferences: jest.fn(),
  saveUiPreferences: jest.fn(),
};

const CURRENT_USER = {
  id: 'user-1',
  role: 'MANAGER',
  companyId: 'co-1',
};

describe('UserController', () => {
  let controller: UserController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: mockUserService }],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  describe('create', () => {
    it('forca o companyId do JWT, ignorando o do body (anti-IDOR)', async () => {
      mockUserService.create.mockResolvedValue({ id: 'novo' });

      // Desde o fix de IDOR, companyId nem existe mais no CreateUserDto
      // (ValidationPipe rejeita); o controller passa o companyId do JWT
      // como argumento separado e o service o força sobre qualquer resíduo.
      await controller.create(
        {
          name: 'X',
          email: 'x@gdr.com.br',
          password: 'senha123',
          role: 'READER' as any,
          companyId: 'empresa-de-outro', // atacante tenta criar user em outra empresa
        } as any,
        CURRENT_USER,
      );

      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.anything(),
        'co-1', // companyId SEMPRE do JWT, nunca do body
        'user-1', // #738: ator (grantedBy do vínculo v2) do JWT, nunca do body
      );
    });

    it('#738: passa o id do ator do JWT como 3º argumento (grantedBy do espelho)', async () => {
      mockUserService.create.mockResolvedValue({ id: 'novo' });

      await controller.create(
        { name: 'X', email: 'x@gdr.com.br', password: 'senha123', role: 'READER' as any } as any,
        { ...CURRENT_USER, id: 'admin-do-jwt' },
      );

      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.anything(),
        'co-1',
        'admin-do-jwt',
      );
    });
  });

  describe('findAll', () => {
    it('repassa o user autenticado para escopo por empresa', async () => {
      mockUserService.findAll.mockResolvedValue([]);

      await controller.findAll(CURRENT_USER);

      expect(mockUserService.findAll).toHaveBeenCalledWith(CURRENT_USER);
    });
  });

  describe('findOne', () => {
    it('repassa o ATOR do JWT, nunca companyId de query/param', async () => {
      mockUserService.findOne.mockResolvedValue({ id: 'user-2' });

      await controller.findOne('user-2', CURRENT_USER);

      // #1107: o serviço precisa do ator INTEIRO (id + companyId) — a
      // ampliação de escopo é capability do usuário, resolvida no
      // TenantScopeService. Nada aqui vem de query ou param.
      expect(mockUserService.findOne).toHaveBeenCalledWith('user-2', CURRENT_USER);
    });
  });

  describe('update', () => {
    it('usa companyId E id do ATOR vindos do JWT (escopo + bloqueio de autoinativação)', async () => {
      mockUserService.update.mockResolvedValue({ id: 'user-2' });

      await controller.update('user-2', { name: 'Novo' } as any, CURRENT_USER);

      // #1107: um único objeto ator (id + companyId), ambos do JWT.
      expect(mockUserService.update).toHaveBeenCalledWith(
        'user-2',
        { name: 'Novo' },
        CURRENT_USER,
      );
    });
  });

  describe('preferencias de UI (#975)', () => {
    it('GET me/preferences escopa pelo user do JWT (dado pessoal)', async () => {
      mockUserService.getUiPreferences.mockResolvedValue({
        favorites: ['/sales'],
        collapsedSections: [],
      });

      await controller.getUiPreferences(CURRENT_USER);

      expect(mockUserService.getUiPreferences).toHaveBeenCalledWith(CURRENT_USER);
    });

    it('PUT me/preferences salva para o user do JWT, nunca para outro', async () => {
      mockUserService.saveUiPreferences.mockResolvedValue({
        favorites: ['/crm'],
        collapsedSections: ['fiscal'],
      });

      await controller.saveUiPreferences(
        { favorites: ['/crm'], collapsedSections: ['fiscal'] },
        CURRENT_USER,
      );

      expect(mockUserService.saveUiPreferences).toHaveBeenCalledWith(CURRENT_USER, {
        favorites: ['/crm'],
        collapsedSections: ['fiscal'],
      });
    });
  });

  describe('respostas nunca expoem credenciais', () => {
    it('retorno do create nao contem password nem passwordHash', async () => {
      // o service ja usa select seguro; aqui garantimos o contrato na borda HTTP
      mockUserService.create.mockResolvedValue({
        id: 'novo',
        email: 'x@gdr.com.br',
      });

      const result = await controller.create(
        {
          name: 'X',
          email: 'x@gdr.com.br',
          password: 'senha123',
          role: 'READER' as any,
          companyId: 'co-1',
        },
        CURRENT_USER,
      );

      expect((result as any).password).toBeUndefined();
      expect((result as any).passwordHash).toBeUndefined();
    });
  });
});
