import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  PermissionCacheService,
  PERMISSION_CACHE_TTL_SECONDS,
  CachedPermissionSet,
} from './permission-cache.service';

/**
 * Testes do PermissionCacheService (#340) — client ioredis mockado por
 * injeção direta (nenhuma conexão real). Foco: contrato de chave/TTL e
 * FALLBACK GRACIOSO (Redis fora do ar nunca lança, nunca bloqueia).
 */

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
  disconnect: jest.fn(),
};

const sample: CachedPermissionSet = {
  v: 1,
  roles: ['VENDEDOR'],
  permissions: ['sales.orders.view'],
};

describe('PermissionCacheService', () => {
  let service: PermissionCacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionCacheService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(PermissionCacheService);
    jest.clearAllMocks();
    // Injeta o client mockado (evita conexão real do getClient)
    (service as any).client = mockRedis;
  });

  describe('get/set/del — contrato de chave e TTL', () => {
    it('get: lê a chave iam:perms:{companyId}:{userId} e parseia o JSON', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(sample));

      const result = await service.get('c1', 'u1');

      expect(mockRedis.get).toHaveBeenCalledWith('iam:perms:c1:u1');
      expect(result).toEqual(sample);
    });

    it('get: miss retorna null', async () => {
      mockRedis.get.mockResolvedValue(null);
      await expect(service.get('c1', 'u1')).resolves.toBeNull();
    });

    it('get: payload de versão desconhecida vira miss (não lança)', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ v: 99, foo: 'bar' }));
      await expect(service.get('c1', 'u1')).resolves.toBeNull();
    });

    it('get: JSON corrompido vira miss (não lança)', async () => {
      mockRedis.get.mockResolvedValue('{corrompido');
      await expect(service.get('c1', 'u1')).resolves.toBeNull();
    });

    it('set: grava com TTL de 5 minutos', async () => {
      await service.set('c1', 'u1', sample);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'iam:perms:c1:u1',
        JSON.stringify(sample),
        'EX',
        PERMISSION_CACHE_TTL_SECONDS,
      );
      expect(PERMISSION_CACHE_TTL_SECONDS).toBe(300);
    });

    it('del: deleta as chaves de permissões E de escopo (#347-B)', async () => {
      await service.del('c1', 'u1');
      expect(mockRedis.del).toHaveBeenCalledWith('iam:perms:c1:u1', 'iam:scope:c1:u1');
    });
  });

  describe('invalidação por padrão (SCAN, nunca KEYS)', () => {
    it('delCompany: varre iam:perms:{companyId}:* e deleta em lotes', async () => {
      mockRedis.scan
        .mockResolvedValueOnce(['7', ['iam:perms:c1:u1', 'iam:perms:c1:u2']])
        .mockResolvedValueOnce(['0', ['iam:perms:c1:u3']]);

      await service.delCompany('c1');

      expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'iam:perms:c1:*', 'COUNT', 200);
      expect(mockRedis.scan).toHaveBeenCalledWith('7', 'MATCH', 'iam:perms:c1:*', 'COUNT', 200);
      expect(mockRedis.del).toHaveBeenCalledWith('iam:perms:c1:u1', 'iam:perms:c1:u2');
      expect(mockRedis.del).toHaveBeenCalledWith('iam:perms:c1:u3');
    });

    it('delUserAllCompanies: varre iam:perms:*:{userId}', async () => {
      mockRedis.scan.mockResolvedValue(['0', []]);

      await service.delUserAllCompanies('u1');

      expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'iam:perms:*:u1', 'COUNT', 200);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('fallback gracioso — Redis fora do ar NUNCA lança', () => {
    beforeEach(() => {
      const down = new Error('connect ECONNREFUSED');
      mockRedis.get.mockRejectedValue(down);
      mockRedis.set.mockRejectedValue(down);
      mockRedis.del.mockRejectedValue(down);
      mockRedis.scan.mockRejectedValue(down);
    });

    it('get devolve null (PermissionService cai para o banco)', async () => {
      await expect(service.get('c1', 'u1')).resolves.toBeNull();
    });

    it('set/del/delCompany/delUserAllCompanies viram no-op silencioso', async () => {
      await expect(service.set('c1', 'u1', sample)).resolves.toBeUndefined();
      await expect(service.del('c1', 'u1')).resolves.toBeUndefined();
      await expect(service.delCompany('c1')).resolves.toBeUndefined();
      await expect(service.delUserAllCompanies('u1')).resolves.toBeUndefined();
    });
  });

  it('onModuleDestroy desconecta o client', async () => {
    await service.onModuleDestroy();
    expect(mockRedis.disconnect).toHaveBeenCalled();
  });
});
