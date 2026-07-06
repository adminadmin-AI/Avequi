import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmSettingsService } from './crm-settings.service';

const COMPANY = 'company-1';

describe('CrmSettingsService', () => {
  let service: CrmSettingsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      systemParameter: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({ waPhoneNumberId: 'pnid-1' }),
        update: jest.fn(),
      },
      user: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [CrmSettingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CrmSettingsService);
  });

  it('get: devolve defaults quando não há parâmetros salvos', async () => {
    const s = await service.get(COMPANY);
    expect(s.slaFirstResponseMin).toBe(15);
    expect(s.coolingHours).toBe(24);
    expect(s.reopenLostDays).toBe(90);
    expect(s.autoFollowupEnabled).toBe(false);
    expect(s.waPhoneNumberId).toBe('pnid-1');
  });

  it('get: lê valores salvos', async () => {
    prisma.systemParameter.findMany.mockResolvedValue([
      { key: 'CRM_SLA_FIRST_RESPONSE_MIN', value: '10' },
      { key: 'CRM_AUTO_FOLLOWUP_ENABLED', value: 'true' },
    ]);
    const s = await service.get(COMPANY);
    expect(s.slaFirstResponseMin).toBe(10);
    expect(s.autoFollowupEnabled).toBe(true);
  });

  it('update: grava SLA e número de WhatsApp', async () => {
    await service.update(COMPANY, { slaFirstResponseMin: 20, waPhoneNumberId: 'pnid-novo' });
    expect(prisma.systemParameter.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { companyId: COMPANY, key: 'CRM_SLA_FIRST_RESPONSE_MIN', value: '20' } }),
    );
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { waPhoneNumberId: 'pnid-novo' } }),
    );
  });

  it('update: SLA <= 0 → 400', async () => {
    await expect(service.update(COMPANY, { slaFirstResponseMin: 0 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('setSellerAvailability: liga/desliga vendedor da loja', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'seller-1' });
    prisma.user.update.mockResolvedValue({ id: 'seller-1', crmAvailable: false });
    await service.setSellerAvailability(COMPANY, 'seller-1', false);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { crmAvailable: false } }),
    );
  });

  it('setSellerAvailability: vendedor de outra loja → 404', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.setSellerAvailability(COMPANY, 'intruso', true),
    ).rejects.toThrow(NotFoundException);
  });
});
