import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotationPdfService } from '../quotation/quotation-pdf.service';
import { LeadProposalService } from './lead-proposal.service';
import { WhatsappService } from './whatsapp/whatsapp.service';

const mockPrisma = {
  lead: { findFirst: jest.fn() },
  quotation: { findFirst: jest.fn(), findMany: jest.fn() },
  leadActivity: { create: jest.fn() },
};
const mockPdf = {
  generate: jest.fn().mockResolvedValue({ buffer: Buffer.from('%PDF-fake'), filename: 'proposta-x.pdf' }),
};
const mockWhatsapp = { sendUploadedMedia: jest.fn().mockResolvedValue({ id: 'msg-1' }) };

describe('LeadProposalService (#572)', () => {
  let service: LeadProposalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadProposalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QuotationPdfService, useValue: mockPdf },
        { provide: WhatsappService, useValue: mockWhatsapp },
      ],
    }).compile();
    service = module.get(LeadProposalService);
    jest.clearAllMocks();
    mockPdf.generate.mockResolvedValue({ buffer: Buffer.from('%PDF-fake'), filename: 'proposta-x.pdf' });
    mockWhatsapp.sendUploadedMedia.mockResolvedValue({ id: 'msg-1' });
  });

  describe('listQuotationsForLead', () => {
    it('lead sem cliente → customerLinked=false sem consultar cotações', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ customerId: null });
      const res = await service.listQuotationsForLead('co-1', 'lead-1');
      expect(res).toEqual({ customerLinked: false, quotations: [] });
      expect(mockPrisma.quotation.findMany).not.toHaveBeenCalled();
    });

    it('lista cotações do cliente com total calculado (desconto por item)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ customerId: 'cust-1' });
      mockPrisma.quotation.findMany.mockResolvedValue([
        {
          id: 'q1', status: 'SENT', validUntil: null, createdAt: new Date(),
          items: [
            { quantity: 1, unitPrice: 1000, discount: 10 }, // 900
            { quantity: 2, unitPrice: 100, discount: 0 }, // 200
          ],
        },
      ]);
      const res = await service.listQuotationsForLead('co-1', 'lead-1');
      expect(res.customerLinked).toBe(true);
      expect(res.quotations[0].total).toBe(1100);
      // tenancy: filtra pela company E pelo cliente do lead
      expect(mockPrisma.quotation.findMany.mock.calls[0][0].where).toEqual({
        companyId: 'co-1',
        customerId: 'cust-1',
      });
    });
  });

  describe('sendProposal', () => {
    it('lead sem cliente → orienta converter primeiro', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', customerId: null });
      await expect(service.sendProposal('co-1', 'lead-1', 'q1', 'user-1')).rejects.toThrow(
        /converta o lead/i,
      );
    });

    it('cotação de OUTRO cliente → bloqueia (vínculo)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', customerId: 'cust-1' });
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'q1', customerId: 'cust-OUTRO' });
      await expect(service.sendProposal('co-1', 'lead-1', 'q1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockWhatsapp.sendUploadedMedia).not.toHaveBeenCalled();
    });

    it('cotação de outra company → NotFound (tenancy)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', customerId: 'cust-1' });
      mockPrisma.quotation.findFirst.mockResolvedValue(null);
      await expect(service.sendProposal('co-1', 'lead-1', 'q1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('fluxo feliz: gera PDF, envia como documento e registra proposal_sent', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', customerId: 'cust-1' });
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'q1', customerId: 'cust-1' });

      const res = await service.sendProposal('co-1', 'lead-1', 'q1', 'user-1');

      expect(res.sent).toBe(true);
      const media = mockWhatsapp.sendUploadedMedia.mock.calls[0];
      expect(media[0]).toBe('co-1');
      expect(media[1]).toBe('lead-1');
      expect(media[2].mimetype).toBe('application/pdf');
      expect(media[2].originalname).toBe('proposta-x.pdf');
      expect(media[4]).toBe('user-1'); // senderId → takeover implícito do SDR

      const activity = mockPrisma.leadActivity.create.mock.calls[0][0].data;
      expect(activity.properties.kind).toBe('proposal_sent');
      expect(activity.properties.quotationId).toBe('q1');
      expect(activity.actorId).toBe('user-1');
    });
  });
});
