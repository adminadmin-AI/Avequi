import { createFakePrisma, DEMO_ONLY_MODELS } from './fake-prisma';

jest.mock('../../../prisma/seeds/iam.seed', () => ({
  seedIam: jest.fn(async () => ({
    permissionsUpserted: 1,
    orphanPermissionCodes: [],
    rolesUpserted: 1,
    rolePermissionsCreated: 0,
    rolePermissionsRemoved: 0,
    userAssignmentsCreated: 0,
    usersSkipped: 0,
  })),
}));
jest.mock('../../../prisma/seeds/plans.seed', () => ({
  seedPlans: jest.fn(async () => 3),
}));

import { seedIam } from '../../../prisma/seeds/iam.seed';
import { seedPlans } from '../../../prisma/seeds/plans.seed';
import { seedStructural } from '../../../prisma/seeds/structural.seed';
import { CCLASSTRIB_TABLE } from '../../modules/tax/data/cclasstrib.data';

describe('seedStructural (Onda 0 — higiene do seed IAM)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    (seedIam as jest.Mock).mockClear();
    (seedPlans as jest.Mock).mockClear();
  });
  afterEach(() => jest.restoreAllMocks());

  it('roda cClassTrib + IAM + planos e devolve o resumo', async () => {
    const fake = createFakePrisma();
    const summary = await seedStructural(fake.client);

    expect(summary.cclasstribCodes).toBe(CCLASSTRIB_TABLE.length);
    expect(fake.callsOf('tributaryClassification', 'upsert')).toHaveLength(CCLASSTRIB_TABLE.length);
    expect(seedIam).toHaveBeenCalledTimes(1);
    expect(seedIam).toHaveBeenCalledWith(fake.client);
    expect(seedPlans).toHaveBeenCalledTimes(1);
    expect(summary.plansUpserted).toBe(3);
  });

  it('NÃO cria Company, User nem qualquer dado de demonstração', async () => {
    const fake = createFakePrisma();
    await seedStructural(fake.client);

    const touched = fake.modelsTouched();
    for (const model of DEMO_ONLY_MODELS) {
      expect(touched).not.toContain(model);
    }
    expect(touched).toEqual(['tributaryClassification']);
  });

  it('nenhum e-mail ou senha aparece nas escritas do estrutural', async () => {
    const fake = createFakePrisma();
    await seedStructural(fake.client);

    const payload = JSON.stringify(fake.calls);
    expect(payload).not.toMatch(/@/);
    expect(payload).not.toMatch(/passwordHash/);
  });
});
