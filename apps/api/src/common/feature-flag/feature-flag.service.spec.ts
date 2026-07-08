import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlag, FeatureFlagService } from './feature-flag.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  systemParameter: { findUnique: jest.fn() },
};

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

describe('FeatureFlagService', () => {
  let service: FeatureFlagService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(FeatureFlagService);
  });

  it('retorna false quando o parâmetro não existe (default OFF)', async () => {
    mockPrisma.systemParameter.findUnique.mockResolvedValue(null);

    await expect(service.isEnabled(COMPANY_A, FeatureFlag.RENAVE_ENABLED)).resolves.toBe(false);
  });

  it('retorna false quando o valor é "false"', async () => {
    mockPrisma.systemParameter.findUnique.mockResolvedValue({ value: 'false' });

    await expect(service.isEnabled(COMPANY_A, FeatureFlag.RENAVE_ENABLED)).resolves.toBe(false);
  });

  it('retorna true quando o valor é "true"', async () => {
    mockPrisma.systemParameter.findUnique.mockResolvedValue({ value: 'true' });

    await expect(service.isEnabled(COMPANY_A, FeatureFlag.RENAVE_ENABLED)).resolves.toBe(true);
  });

  it('retorna false para valor inválido (fail-closed)', async () => {
    mockPrisma.systemParameter.findUnique.mockResolvedValue({ value: 'xyz' });

    await expect(service.isEnabled(COMPANY_A, FeatureFlag.RENAVE_ENABLED)).resolves.toBe(false);
  });

  it('normaliza case e espaços: " TRUE " → true', async () => {
    mockPrisma.systemParameter.findUnique.mockResolvedValue({ value: ' TRUE ' });

    await expect(service.isEnabled(COMPANY_A, FeatureFlag.RENAVE_ENABLED)).resolves.toBe(true);
  });

  it('isola por companyId: company A ON não vaza para company B', async () => {
    // Simula banco: parâmetro "true" só existe para a company A
    mockPrisma.systemParameter.findUnique.mockImplementation(({ where }: any) =>
      where.companyId_key.companyId === COMPANY_A &&
      where.companyId_key.key === FeatureFlag.RENAVE_ENABLED
        ? Promise.resolve({ value: 'true' })
        : Promise.resolve(null),
    );

    await expect(service.isEnabled(COMPANY_A, FeatureFlag.RENAVE_ENABLED)).resolves.toBe(true);
    await expect(service.isEnabled(COMPANY_B, FeatureFlag.RENAVE_ENABLED)).resolves.toBe(false);

    // A query enviada ao Prisma carrega o companyId correto em cada chamada
    expect(mockPrisma.systemParameter.findUnique).toHaveBeenCalledWith({
      where: { companyId_key: { companyId: COMPANY_A, key: 'renave.enabled' } },
    });
    expect(mockPrisma.systemParameter.findUnique).toHaveBeenCalledWith({
      where: { companyId_key: { companyId: COMPANY_B, key: 'renave.enabled' } },
    });
  });
});
