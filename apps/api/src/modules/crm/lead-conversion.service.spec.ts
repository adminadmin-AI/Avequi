import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadConversionService } from './lead-conversion.service';

const COMPANY = 'company-1';

describe('LeadConversionService', () => {
  let service: LeadConversionService;
  let prisma: any;
  let events: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      lead: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      customer: { findFirst: jest.fn(), create: jest.fn() },
      salesOrder: { findFirst: jest.fn() },
      pipelineStage: { findFirst: jest.fn() },
    };
    events = { emit: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadConversionService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(LeadConversionService);
  });

  describe('convertToCustomer', () => {
    it('cria cliente novo quando telefone não existe', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        phone: '5545999998888',
        name: 'João',
        customer: null,
      });
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue({ id: 'cust-new', name: 'João' });

      const result = await service.convertToCustomer(COMPANY, 'lead-1', 'seller-1');

      expect(result.created).toBe(true);
      expect(result.customerId).toBe('cust-new');
      expect(result.prefill?.leadId).toBe('lead-1');
      expect(prisma.lead.update.mock.calls[0][0].data.activities.create.type).toBe('CONVERSION');
      expect(events.emit).toHaveBeenCalledWith('crm.lead.converted', expect.any(Object));
    });

    it('reaproveita cliente existente pelo telefone (sem duplicar)', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        phone: '5545999998888',
        customer: null,
      });
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-old', name: 'Maria' });

      const result = await service.convertToCustomer(COMPANY, 'lead-1', 'seller-1');
      expect(result.created).toBe(false);
      expect(result.customerId).toBe('cust-old');
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('idempotente: lead já convertido devolve o mesmo cliente', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        customerId: 'cust-x',
        customer: { id: 'cust-x', name: 'Z' },
      });
      const result = await service.convertToCustomer(COMPANY, 'lead-1', 'seller-1');
      expect(result.created).toBe(false);
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('lead de outra loja → 404', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);
      await expect(service.convertToCustomer(COMPANY, 'x', 'u1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('closeWonBySalesOrder (listener SALE_INVOICED)', () => {
    it('move lead vinculado p/ estágio WON e emite evento', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', stageId: 's-open' });
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 's-won', name: 'Fechado' });

      await service.closeWonBySalesOrder(COMPANY, 'so-1');

      const data = prisma.lead.update.mock.calls[0][0].data;
      expect(data.stageId).toBe('s-won');
      expect(data.activities.create.properties.reason).toBe('NF-e emitida (auto)');
      expect(events.emit).toHaveBeenCalledWith(
        'crm.lead.stage_changed',
        expect.objectContaining({ stageType: 'WON' }),
      );
    });

    it('OV sem lead vinculado → no-op (venda direta)', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);
      await service.closeWonBySalesOrder(COMPANY, 'so-direta');
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('lead já em WON → não faz nada', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', stageId: 's-won' });
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 's-won', name: 'Fechado' });
      await service.closeWonBySalesOrder(COMPANY, 'so-1');
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });
  });

  describe('linkSalesOrder', () => {
    it('vincula OV ao lead', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', customerId: null });
      prisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', customerId: 'cust-1' });
      await service.linkSalesOrder(COMPANY, 'lead-1', 'so-1');
      const data = prisma.lead.update.mock.calls[0][0].data;
      expect(data.salesOrderId).toBe('so-1');
      expect(data.customerId).toBe('cust-1');
    });
  });
});
