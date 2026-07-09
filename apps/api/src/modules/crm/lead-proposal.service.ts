import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadActivityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotationPdfService } from '../quotation/quotation-pdf.service';
import { WhatsappService } from './whatsapp/whatsapp.service';

/**
 * #572 — proposta em PDF da cotação direto no inbox. Fecha o ciclo comercial
 * dentro da ferramenta: cotação → PDF (brandbook GDR) → documento no WhatsApp
 * do cliente, com rastro `proposal_sent` na timeline do lead.
 */
@Injectable()
export class LeadProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotationPdf: QuotationPdfService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /** Cotações do cliente vinculado ao lead — opções do "Enviar proposta" */
  async listQuotationsForLead(companyId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: { customerId: true },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (!lead.customerId) return { customerLinked: false, quotations: [] };

    const quotations = await this.prisma.quotation.findMany({
      where: { companyId, customerId: lead.customerId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        validUntil: true,
        createdAt: true,
        items: { select: { quantity: true, unitPrice: true, discount: true } },
      },
    });
    return {
      customerLinked: true,
      quotations: quotations.map((q) => ({
        id: q.id,
        status: q.status,
        validUntil: q.validUntil,
        createdAt: q.createdAt,
        total: q.items.reduce(
          (s, i) => s + Number(i.quantity) * Number(i.unitPrice) * (1 - Number(i.discount ?? 0) / 100),
          0,
        ),
      })),
    };
  }

  /** Gera o PDF da cotação e envia como documento na conversa do lead */
  async sendProposal(companyId: string, leadId: string, quotationId: string, senderId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: { id: true, customerId: true },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (!lead.customerId) {
      throw new BadRequestException(
        'Lead sem cliente vinculado — converta o lead em cliente antes de enviar proposta',
      );
    }

    // tenancy + vínculo: a cotação precisa ser da MESMA loja e do MESMO cliente
    const quotation = await this.prisma.quotation.findFirst({
      where: { id: quotationId, companyId },
      select: { id: true, customerId: true },
    });
    if (!quotation) throw new NotFoundException('Cotação não encontrada');
    if (quotation.customerId !== lead.customerId) {
      throw new BadRequestException('Cotação não pertence ao cliente deste lead');
    }

    const { buffer, filename } = await this.quotationPdf.generate(quotationId, companyId);

    const message = await this.whatsapp.sendUploadedMedia(
      companyId,
      leadId,
      { buffer, mimetype: 'application/pdf', originalname: filename, size: buffer.length },
      undefined,
      senderId,
    );

    // rastro na timeline — base do dashboard de propostas enviadas (futuro)
    await this.prisma.leadActivity.create({
      data: {
        leadId,
        type: LeadActivityType.NOTE,
        actorId: senderId,
        properties: {
          kind: 'proposal_sent',
          quotationId,
          preview: `📄 Proposta enviada (${filename})`,
        },
      },
    });

    return { sent: true, quotationId, filename, messageId: (message as any)?.id };
  }
}
