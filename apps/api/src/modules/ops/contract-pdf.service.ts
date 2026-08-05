import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractParams, renderClauses, TEMPLATE_VERSION } from './contract-template';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

/** Paleta do brandbook (mesma família do quotation-pdf). */
const INK = '#111111';
const MUTED = '#555555';
const BRAND = '#3D2CE6';
const LINE = '#DDDDDD';

/**
 * #992 — Contrato de prestação de serviços SaaS em PDF, gerado on-demand a
 * partir dos dados vivos (operadora + conta + assinatura + plano). Stateless
 * de propósito: nada persiste; o rodapé carimba versão do template e data de
 * emissão, e a proposta ACEITA mais recente (se houver) entra como evidência
 * do aceite comercial. Sem assinatura ativa não há o que contratar → 400.
 */
@Injectable()
export class ContractPdfService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(tenantId: string): Promise<{ buffer: Buffer; filename: string }> {
    const operadoraId = process.env.OPERADORA_COMPANY_ID?.trim();
    if (!operadoraId) {
      throw new ServiceUnavailableException(
        'Contrato indisponível: a env OPERADORA_COMPANY_ID não está configurada no servidor.',
      );
    }

    const [operadora, cliente, subscription] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: operadoraId } }),
      this.prisma.company.findUnique({ where: { id: tenantId } }),
      this.prisma.subscription.findUnique({ where: { companyId: tenantId } }),
    ]);
    if (!operadora) {
      throw new ServiceUnavailableException('Empresa da operadora não encontrada no banco.');
    }
    if (!cliente || cliente.parentId) {
      // contrato é sempre com a empresa RAIZ da conta
      throw new NotFoundException('Conta não encontrada');
    }
    if (!subscription || subscription.canceledAt) {
      throw new BadRequestException(
        'A conta não tem assinatura ativa — crie a assinatura antes de gerar o contrato.',
      );
    }

    // Evidência do aceite comercial (proposta ACEITA mais recente) + nome do
    // plano de referência comercial, se houver.
    const [proposta, plano] = await Promise.all([
      this.prisma.subscriptionProposal.findFirst({
        where: { companyId: tenantId, status: 'ACCEPTED' },
        orderBy: { decidedAt: 'desc' },
        select: { id: true, decidedAt: true },
      }),
      subscription.planId
        ? this.prisma.plan.findUnique({ where: { id: subscription.planId }, select: { name: true } })
        : Promise.resolve(null),
    ]);

    const params: ContractParams = {
      operadora: {
        razaoSocial: operadora.razaoSocial ?? operadora.name,
        cnpj: formatCnpj(operadora.cnpj),
        im: operadora.im ?? null,
        endereco: enderecoLinha(operadora),
        email: operadora.email ?? null,
        cidadeForo: operadora.city ? `${operadora.city}/${operadora.state ?? ''}`.replace(/\/$/, '') : null,
      },
      cliente: {
        razaoSocial: cliente.razaoSocial ?? cliente.name,
        cnpj: formatCnpj(cliente.cnpj),
        endereco: enderecoLinha(cliente),
        email: cliente.email ?? null,
      },
      comercial: {
        mensalidadeFormatada: (subscription.priceCents / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        }),
        diaCobranca: subscription.billingDay,
        inicioVigencia: subscription.startedAt.toLocaleDateString('pt-BR'),
        planoNome: plano?.name ?? null,
        propostaAceita: proposta?.decidedAt
          ? { id: proposta.id, decididaEm: proposta.decidedAt.toLocaleDateString('pt-BR') }
          : null,
      },
    };

    const buffer = await this.render(params);
    const slug = (cliente.name ?? 'cliente').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { buffer, filename: `contrato-avecchi-${slug}.pdf` };
  }

  private render(p: ContractParams): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    // ── Cabeçalho ────────────────────────────────────────────────────────
    doc.fillColor(BRAND).fontSize(20).font('Helvetica-Bold').text('AVECCHI');
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .font('Helvetica')
      .text('Contrato de Prestação de Serviços — Software de Gestão (SaaS)', { paragraphGap: 2 });
    doc.moveDown(0.6);
    hr(doc);

    // ── Partes ───────────────────────────────────────────────────────────
    doc.moveDown(0.8);
    parte(doc, 'CONTRATADA', [
      p.operadora.razaoSocial,
      `CNPJ ${p.operadora.cnpj}${p.operadora.im ? ` · Inscrição Municipal ${p.operadora.im}` : ''}`,
      p.operadora.endereco ?? '[● PREENCHER NO CADASTRO DA EMPRESA]',
      p.operadora.email ? `E-mail: ${p.operadora.email}` : null,
    ]);
    doc.moveDown(0.5);
    parte(doc, 'CONTRATANTE', [
      p.cliente.razaoSocial,
      `CNPJ ${p.cliente.cnpj}`,
      p.cliente.endereco ?? '[● PREENCHER NO CADASTRO DA EMPRESA]',
      p.cliente.email ? `E-mail: ${p.cliente.email}` : null,
    ]);

    doc.moveDown(0.6);
    doc
      .fillColor(INK)
      .fontSize(9.5)
      .font('Helvetica')
      .text(
        'As partes acima qualificadas celebram o presente contrato de licença de uso de software e prestação ' +
          'de serviços, que se regerá pelas cláusulas seguintes:',
        { align: 'justify' },
      );

    // ── Cláusulas ────────────────────────────────────────────────────────
    for (const clause of renderClauses(p)) {
      doc.moveDown(0.7);
      doc.fillColor(INK).fontSize(10.5).font('Helvetica-Bold').text(clause.title);
      doc.moveDown(0.15);
      doc.fillColor(INK).fontSize(9.5).font('Helvetica').text(clause.body, { align: 'justify' });
    }

    // ── Evidência do aceite comercial ────────────────────────────────────
    if (p.comercial.propostaAceita) {
      doc.moveDown(0.8);
      doc
        .fillColor(MUTED)
        .fontSize(8.5)
        .font('Helvetica-Oblique')
        .text(
          `Condições comerciais aceitas eletronicamente pela CONTRATANTE na proposta ` +
            `${p.comercial.propostaAceita.id.slice(-8).toUpperCase()} em ${p.comercial.propostaAceita.decididaEm}, ` +
            `registrada no portal da CONTRATADA.`,
          { align: 'justify' },
        );
    }

    // ── Assinaturas ──────────────────────────────────────────────────────
    doc.moveDown(2.2);
    const y = doc.y;
    const col = (doc.page.width - 112) / 2 - 12;
    assinatura(doc, 56, y, col, p.operadora.razaoSocial, 'CONTRATADA');
    assinatura(doc, 56 + col + 24, y, col, p.cliente.razaoSocial, 'CONTRATANTE');

    // ── Rodapé em todas as páginas ───────────────────────────────────────
    const emitido = new Date().toLocaleDateString('pt-BR');
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .fillColor(MUTED)
        .fontSize(7.5)
        .font('Helvetica')
        .text(
          `${TEMPLATE_VERSION} · emitido em ${emitido} pelo portal Avecchi · página ${i + 1} de ${range.count}`,
          56,
          doc.page.height - 40,
          { width: doc.page.width - 112, align: 'center' },
        );
    }

    doc.end();
    return done;
  }
}

function hr(doc: any) {
  doc
    .strokeColor(LINE)
    .lineWidth(1)
    .moveTo(56, doc.y)
    .lineTo(doc.page.width - 56, doc.y)
    .stroke();
}

function parte(doc: any, papel: string, linhas: Array<string | null>) {
  doc.fillColor(BRAND).fontSize(8).font('Helvetica-Bold').text(papel);
  doc.moveDown(0.1);
  for (const linha of linhas) {
    if (!linha) continue;
    doc.fillColor(INK).fontSize(9.5).font('Helvetica').text(linha);
  }
}

function assinatura(doc: any, x: number, y: number, width: number, nome: string, papel: string) {
  doc
    .strokeColor(INK)
    .lineWidth(0.8)
    .moveTo(x, y + 36)
    .lineTo(x + width, y + 36)
    .stroke();
  doc.fillColor(INK).fontSize(8.5).font('Helvetica-Bold').text(nome, x, y + 41, { width, align: 'center' });
  doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(papel, x, doc.y + 1, { width, align: 'center' });
}

function formatCnpj(raw: string | null): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length !== 14) return raw ?? '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function enderecoLinha(c: {
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}): string | null {
  if (!c.street || !c.city) return null;
  const partes = [
    `${c.street}${c.number ? `, ${c.number}` : ''}`,
    c.neighborhood,
    `${c.city}${c.state ? `/${c.state}` : ''}`,
    c.zipCode ? `CEP ${c.zipCode}` : null,
  ].filter(Boolean);
  return partes.join(' — ');
}
