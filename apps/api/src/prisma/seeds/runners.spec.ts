import { createFakePrisma } from './fake-prisma';

jest.mock('../../../prisma/seeds/structural.seed', () => ({
  seedStructural: jest.fn(async () => ({ cclasstribCodes: 0, iam: {}, plansUpserted: 0 })),
}));
jest.mock('../../../prisma/seeds/iam.seed', () => ({
  seedIam: jest.fn(async () => ({ permissionsUpserted: 0 })),
}));
jest.mock('../../../prisma/seeds/demo.seed', () => ({
  seedDemo: jest.fn(async () => ({ companies: 2, users: 4 })),
}));

import { seedDemo } from '../../../prisma/seeds/demo.seed';
import { seedIam } from '../../../prisma/seeds/iam.seed';
import { runDemoSeed, runIamSeed, runStructuralSeed } from '../../../prisma/seeds/runners';
import { SeedBlockedError } from '../../../prisma/seeds/seed-guard';
import { seedStructural } from '../../../prisma/seeds/structural.seed';

const PROD = { NODE_ENV: 'production' };
const PROD_ALLOWED = { NODE_ENV: 'production', ALLOW_PROD_SEED: 'true' };
const DEV = { NODE_ENV: 'development', SEED_USER_PASSWORD: 'Senha-De-Teste-Forte-123' };

describe('runners dos seeds (Onda 0 — higiene do seed IAM)', () => {
  beforeEach(() => {
    (seedStructural as jest.Mock).mockClear();
    (seedIam as jest.Mock).mockClear();
    (seedDemo as jest.Mock).mockClear();
  });

  describe('runStructuralSeed (npm run db:seed)', () => {
    it('produção sem flag: bloqueia antes de tocar no banco', async () => {
      const fake = createFakePrisma();
      await expect(runStructuralSeed(fake.client, PROD)).rejects.toThrow(SeedBlockedError);
      expect(seedStructural).not.toHaveBeenCalled();
      expect(fake.calls).toHaveLength(0);
    });

    it('produção com ALLOW_PROD_SEED=true: roda', async () => {
      const fake = createFakePrisma();
      await runStructuralSeed(fake.client, PROD_ALLOWED);
      expect(seedStructural).toHaveBeenCalledWith(fake.client);
    });

    it('desenvolvimento: roda', async () => {
      const fake = createFakePrisma();
      await runStructuralSeed(fake.client, DEV);
      expect(seedStructural).toHaveBeenCalledTimes(1);
    });
  });

  describe('runIamSeed (npm run db:seed:iam — runner standalone)', () => {
    it('respeita o mesmo guard do estrutural: produção sem flag bloqueia', async () => {
      const fake = createFakePrisma();
      await expect(runIamSeed(fake.client, PROD)).rejects.toThrow(SeedBlockedError);
      expect(seedIam).not.toHaveBeenCalled();
    });

    it('produção com ALLOW_PROD_SEED=true: roda', async () => {
      const fake = createFakePrisma();
      await runIamSeed(fake.client, PROD_ALLOWED);
      expect(seedIam).toHaveBeenCalledWith(fake.client);
    });

    it('desenvolvimento: roda', async () => {
      const fake = createFakePrisma();
      await runIamSeed(fake.client, DEV);
      expect(seedIam).toHaveBeenCalledTimes(1);
    });
  });

  describe('runDemoSeed (npm run db:seed:demo)', () => {
    it('produção: HARD-BLOCKED mesmo com ALLOW_PROD_SEED=true e senha definida', async () => {
      const fake = createFakePrisma();
      await expect(runDemoSeed(fake.client, { ...PROD_ALLOWED, SEED_USER_PASSWORD: 'x'.repeat(16) })).rejects.toThrow(
        SeedBlockedError,
      );
      await expect(runDemoSeed(fake.client, PROD)).rejects.toThrow(SeedBlockedError);
      expect(seedDemo).not.toHaveBeenCalled();
      expect(fake.calls).toHaveLength(0);
    });

    it('desenvolvimento sem SEED_USER_PASSWORD: falha sem tocar no banco', async () => {
      const fake = createFakePrisma();
      await expect(runDemoSeed(fake.client, { NODE_ENV: 'development' })).rejects.toThrow(/SEED_USER_PASSWORD/);
      expect(seedDemo).not.toHaveBeenCalled();
    });

    it('desenvolvimento com senha: roda e repassa a senha da env', async () => {
      const fake = createFakePrisma();
      const summary = await runDemoSeed(fake.client, DEV);
      expect(seedDemo).toHaveBeenCalledWith(fake.client, { password: DEV.SEED_USER_PASSWORD });
      expect(summary).toEqual({ companies: 2, users: 4 });
    });

    it('NODE_ENV ausente (padrão local) conta como não-produção', async () => {
      const fake = createFakePrisma();
      await runDemoSeed(fake.client, { SEED_USER_PASSWORD: 'x'.repeat(16) });
      expect(seedDemo).toHaveBeenCalledTimes(1);
    });
  });
});
