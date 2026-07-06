import { PrismaService } from './prisma.service';
import {
  isInsidePrismaTransaction,
  runWithTenant,
} from '../common/context/tenant-context';

// Convenção do projeto: nunca banco real em teste unitário.
// O jest mapeia @prisma/client para o stub em __mocks__/generated/prisma;
// além disso os clients internos são substituídos por fakes em cada teste.
describe('PrismaService (propagacao de tenant para RLS)', () => {
  let service: PrismaService;
  let fakeTx: { $executeRaw: jest.Mock };
  let fakeExtended: any;
  let fakeBase: any;

  beforeEach(() => {
    service = new PrismaService();

    fakeTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
    fakeExtended = {
      // Forma interativa por padrão; testes de batch sobrescrevem.
      $transaction: jest.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(fakeTx) : arg.map((_: any, i: number) => `r${i}`),
      ),
      product: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn(),
    };
    fakeBase = {
      $executeRaw: jest.fn().mockReturnValue('SET_CONFIG_PROMISE'),
      $connect: jest.fn(),
      $disconnect: jest.fn(),
    };

    (service as any).extendedClient = fakeExtended;
    (service as any).baseClient = fakeBase;
  });

  describe('delegacao via Proxy (compatibilidade com call sites existentes)', () => {
    it('delegates model access ao client estendido', () => {
      expect((service as any).product).toBe(fakeExtended.product);
    });

    it('delegates $queryRaw ao client estendido', () => {
      expect(typeof (service as any).$queryRaw).toBe('function');
    });
  });

  describe('$transaction interativa', () => {
    it('injeta set_config parametrizado como primeiro statement quando ha tenant', async () => {
      const result = await runWithTenant('company-7', () =>
        service.$transaction(async (tx: any) => {
          expect(tx).toBe(fakeTx);
          return 'done';
        }),
      );

      expect(result).toBe('done');
      expect(fakeTx.$executeRaw).toHaveBeenCalledTimes(1);
      const [strings, ...values] = fakeTx.$executeRaw.mock.calls[0];
      expect(strings.join('?')).toContain(
        "set_config('app.current_company_id', ?, TRUE)",
      );
      expect(values).toEqual(['company-7']);
    });

    it('marca insidePrismaTransaction durante o callback (extensao RLS nao aninha transacao)', async () => {
      let flagDuringCallback: boolean | undefined;
      await runWithTenant('company-7', () =>
        service.$transaction(async () => {
          flagDuringCallback = isInsidePrismaTransaction();
        }),
      );
      expect(flagDuringCallback).toBe(true);
      // Fora da transação a flag não vaza
      expect(isInsidePrismaTransaction()).toBe(false);
    });

    it('sem tenant no contexto: nao injeta set_config', async () => {
      await service.$transaction(async () => 'ok');
      expect(fakeTx.$executeRaw).not.toHaveBeenCalled();
    });

    it('repassa options ao client estendido', async () => {
      const options = { timeout: 5000 };
      await service.$transaction(async () => 'ok', options as any);
      expect(fakeExtended.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        options,
      );
    });
  });

  describe('$transaction batch (array)', () => {
    it('com tenant: prepende set_config e remove o resultado dele', async () => {
      const result = await runWithTenant('company-9', () =>
        service.$transaction(['op-a', 'op-b'] as any),
      );

      // set_config criado no baseClient com bind parameter
      const [strings, ...values] = fakeBase.$executeRaw.mock.calls[0];
      expect(strings.join('?')).toContain(
        "set_config('app.current_company_id', ?, TRUE)",
      );
      expect(values).toEqual(['company-9']);

      // Batch recebeu [set_config, op-a, op-b]
      const ops = fakeExtended.$transaction.mock.calls[0][0];
      expect(ops).toEqual(['SET_CONFIG_PROMISE', 'op-a', 'op-b']);

      // Contrato original preservado: resultados sem o set_config
      expect(result).toEqual(['r1', 'r2']);
    });

    it('sem tenant: repassa o array intacto', async () => {
      const result = await service.$transaction(['op-a', 'op-b'] as any);
      expect(fakeBase.$executeRaw).not.toHaveBeenCalled();
      expect(fakeExtended.$transaction.mock.calls[0][0]).toEqual([
        'op-a',
        'op-b',
      ]);
      expect(result).toEqual(['r0', 'r1']);
    });
  });

  describe('$transactionWithTenant (fluxos sem request HTTP: jobs, cron)', () => {
    it('define o tenant explicito e injeta set_config na transacao', async () => {
      const result = await service.$transactionWithTenant(
        'company-job',
        async (tx: any) => {
          expect(tx).toBe(fakeTx);
          return 42;
        },
      );

      expect(result).toBe(42);
      const [, ...values] = fakeTx.$executeRaw.mock.calls[0];
      expect(values).toEqual(['company-job']);
    });

    it('nunca interpola o companyId na string SQL (sem Unsafe)', async () => {
      const malicious = "x'; DROP TABLE gdr_products; --";
      await service.$transactionWithTenant(malicious, async () => null);

      const [strings, ...values] = fakeTx.$executeRaw.mock.calls[0];
      expect(strings.join('')).not.toContain(malicious);
      expect(values).toEqual([malicious]);
    });
  });

  describe('ciclo de vida', () => {
    it('onModuleInit conecta e onModuleDestroy desconecta o client base', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();
      expect(fakeBase.$connect).toHaveBeenCalledTimes(1);
      expect(fakeBase.$disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
