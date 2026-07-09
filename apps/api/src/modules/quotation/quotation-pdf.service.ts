import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// pdfkit é CJS puro e o projeto NÃO usa esModuleInterop — default import
// vira undefined no runtime (mesma lição do ffmpeg-static, #556)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

/** Paleta do brandbook GDR — tons sóbrios industriais */
const INK = '#1a1d21'; // texto principal
const MUTED = '#6b7280'; // texto secundário
const ACCENT = '#b45309'; // âmbar industrial (títulos/destaques)
const LINE = '#d1d5db';

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtCnpj = (d?: string | null) =>
  d && d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : d ?? '';

/**
 * #572 — proposta comercial em PDF da cotação. pdfkit puro (sem headless
 * browser — leve pro Railway); layout limpo com identidade GDR e os dados
 * fiscais da LOJA emissora (multi-tenant: cada filial assina a própria
 * proposta).
 */
@Injectable()
export class QuotationPdfService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(
    quotationId: string,
    companyId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const q = await this.prisma.quotation.findFirst({
      where: { id: quotationId, companyId },
      include: {
        items: { include: { product: { select: { sku: true, name: true } } } },
        customer: { select: { name: true, document: true, email: true, phone: true } },
        company: {
          select: {
            name: true, razaoSocial: true, cnpj: true, street: true, number: true,
            neighborhood: true, city: true, state: true, zipCode: true, phone: true, email: true,
          },
        },
        createdBy: { select: { name: true } },
      },
    });
    if (!q) throw new NotFoundException(`Orçamento ${quotationId} não encontrado`);

    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    const co = q.company;
    const left = 48;
    const right = doc.page.width - 48;

    // ─── Cabeçalho da loja emissora ─────────────────────────────────────────
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(co.razaoSocial ?? co.name, left, 48);
    doc
      .font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text(
        [
          co.cnpj ? `CNPJ ${fmtCnpj(co.cnpj)}` : null,
          [co.street, co.number].filter(Boolean).join(', ') || null,
          [co.neighborhood, co.city && co.state ? `${co.city}/${co.state}` : co.city, co.zipCode]
            .filter(Boolean)
            .join(' — ') || null,
          [co.phone, co.email].filter(Boolean).join(' · ') || null,
        ]
          .filter(Boolean)
          .join('\n'),
      );

    doc.moveTo(left, doc.y + 10).lineTo(right, doc.y + 10).strokeColor(ACCENT).lineWidth(2).stroke();
    doc.moveDown(1.5);

    // ─── Título + metadados ─────────────────────────────────────────────────
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(14).text('PROPOSTA COMERCIAL');
    doc
      .fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(
        `Nº ${q.id.slice(-8).toUpperCase()} · emitida em ${new Date().toLocaleDateString('pt-BR')}` +
          (q.validUntil ? ` · válida até ${new Date(q.validUntil).toLocaleDateString('pt-BR')}` : ''),
      );
    doc.moveDown(0.8);

    // ─── Cliente ────────────────────────────────────────────────────────────
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Cliente');
    doc
      .font('Helvetica').fontSize(9.5).fillColor(INK)
      .text(
        [
          q.customer?.name ?? '—',
          q.customer?.document ? `Doc: ${q.customer.document}` : null,
          [q.customer?.phone, q.customer?.email].filter(Boolean).join(' · ') || null,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    doc.moveDown(1);

    // ─── Itens ──────────────────────────────────────────────────────────────
    // colunas sem sobreposição: nome (48-308) · qtd · preço · desc · subtotal (…-547)
    const cols = { prod: left, qty: 315, unit: 360, disc: 442, sub: 482 };
    const w = { prod: 260, qty: 40, unit: 75, disc: 35, sub: right - 482 };
    const th = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED);
    doc.text('PRODUTO', cols.prod, th, { width: w.prod });
    doc.text('QTD', cols.qty, th, { width: w.qty, align: 'right' });
    doc.text('PREÇO UNIT.', cols.unit, th, { width: w.unit, align: 'right' });
    doc.text('DESC.', cols.disc, th, { width: w.disc, align: 'right' });
    doc.text('SUBTOTAL', cols.sub, th, { width: w.sub, align: 'right' });
    doc.moveTo(left, doc.y + 3).lineTo(right, doc.y + 3).strokeColor(LINE).lineWidth(0.7).stroke();
    doc.y += 8;

    let itemsTotal = 0;
    for (const it of q.items) {
      const qty = Number(it.quantity);
      const price = Number(it.unitPrice);
      const disc = Number(it.discount ?? 0);
      const sub = qty * price * (1 - disc / 100);
      itemsTotal += sub;

      const y = doc.y;
      // coluna esquerda (nome + SKU) define a altura da linha
      doc.font('Helvetica').fontSize(9).fillColor(INK)
        .text(`${it.product?.name ?? '—'}`, cols.prod, y, { width: w.prod });
      doc.fontSize(7.5).fillColor(MUTED)
        .text(it.product?.sku ?? '', cols.prod, doc.y, { width: w.prod });
      const rowBottom = doc.y;

      doc.font('Helvetica').fontSize(9).fillColor(INK);
      doc.text(String(qty), cols.qty, y, { width: w.qty, align: 'right' });
      doc.text(BRL(price), cols.unit, y, { width: w.unit, align: 'right' });
      doc.text(disc ? `${disc}%` : '—', cols.disc, y, { width: w.disc, align: 'right' });
      doc.text(BRL(sub), cols.sub, y, { width: w.sub, align: 'right' });

      // as células da direita são de 1 linha — a esquerda manda na altura
      doc.y = rowBottom + 6;
    }

    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(LINE).lineWidth(0.7).stroke();
    doc.moveDown(0.5);

    // ─── Total (desconto global da cotação por cima dos itens) ─────────────
    const globalDisc = Number(q.discount ?? 0);
    const total = itemsTotal * (1 - globalDisc / 100);
    if (globalDisc > 0) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text(`Desconto comercial: ${globalDisc}%`, cols.prod, doc.y, { width: right - left, align: 'right' });
    }
    doc
      .font('Helvetica-Bold').fontSize(12).fillColor(ACCENT)
      .text(`TOTAL: ${BRL(total)}`, cols.prod, doc.y + 2, { width: right - left, align: 'right' });
    doc.moveDown(1.2);

    // ─── Condições / observações ────────────────────────────────────────────
    if (q.notes) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Condições', left);
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(q.notes, { width: right - left });
      doc.moveDown(1);
    }

    // ─── Rodapé: vendedor + loja ────────────────────────────────────────────
    doc
      .font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text(
        [
          q.createdBy?.name ? `Vendedor: ${q.createdBy.name}` : null,
          `${co.name}${co.city ? ` — ${co.city}/${co.state ?? ''}` : ''}`,
          'Proposta sujeita a disponibilidade de estoque. Valores válidos até a data indicada.',
        ]
          .filter(Boolean)
          .join('\n'),
        left,
      );

    doc.end();
    const buffer = await done;
    return { buffer, filename: `proposta-${q.id.slice(-8)}.pdf` };
  }
}
