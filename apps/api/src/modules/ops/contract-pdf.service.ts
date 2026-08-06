import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ContratoV2Params, DocumentoContrato, montarDocumento, TEMPLATE_VERSION } from './contract-template';
import { Bloco } from './contract-v2-tipos';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

const INK = '#111111';
const MUTED = '#555555';
const BRAND = '#3D2CE6';
const LINE = '#DDDDDD';
const TABLE_HEAD_BG = '#1A1A1A';

const MARGIN = 56;

/**
 * #992/#1025 — Contrato AVQ-CT v2 em PDF, gerado on-demand a partir dos dados
 * vivos (operadora + conta + assinatura + plano). Stateless: nada persiste; o
 * rodapé carimba versão do template, emissão e paginação. A proposta ACEITA
 * mais recente (se houver) entra como evidência do aceite comercial. Sem
 * assinatura ativa não há o que contratar → 400.
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

    const params: ContratoV2Params = {
      operadora: {
        razaoSocial: operadora.razaoSocial ?? operadora.name,
        cnpj: formatCnpj(operadora.cnpj),
        im: operadora.im ?? null,
        endereco: enderecoLinha(operadora),
        email: operadora.email ?? null,
        comarca: operadora.city ? `${operadora.city}${operadora.state ? `/${operadora.state}` : ''}` : null,
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
        mensalidadePorExtenso: reaisPorExtenso(subscription.priceCents),
        diaCobranca: subscription.billingDay,
        inicioVigencia: subscription.startedAt.toLocaleDateString('pt-BR'),
        planoNome: plano?.name ?? null,
        propostaAceita: proposta?.decidedAt
          ? { id: proposta.id, decididaEm: proposta.decidedAt.toLocaleDateString('pt-BR') }
          : null,
      },
    };

    const buffer = await this.render(montarDocumento(params), params);
    const slug = (cliente.name ?? 'cliente').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { buffer, filename: `contrato-avecchi-${slug}.pdf` };
  }

  private render(docContrato: DocumentoContrato, p: ContratoV2Params): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    const width = doc.page.width - MARGIN * 2;

    // ── Título e preâmbulo ───────────────────────────────────────────────
    doc.fillColor(INK).fontSize(16).font('Helvetica-Bold').text(docContrato.titulo);
    doc.moveDown(0.3);
    doc
      .strokeColor(INK)
      .lineWidth(2)
      .moveTo(MARGIN, doc.y)
      .lineTo(doc.page.width - MARGIN, doc.y)
      .stroke();
    doc.moveDown(0.5);
    doc.fillColor(BRAND).fontSize(11).font('Helvetica-Bold').text('AVECCHI ERP');
    doc.moveDown(0.3);
    doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(docContrato.preambulo, { align: 'justify' });

    // ── Capítulos + Anexos ───────────────────────────────────────────────
    for (const cap of [...docContrato.capitulos, ...docContrato.anexos]) {
      this.garantirEspaco(doc, 60);
      doc.moveDown(1);
      doc.fillColor(INK).fontSize(11).font('Helvetica-Bold').text(cap.titulo, MARGIN, doc.y);
      doc.moveDown(0.1);
      doc
        .strokeColor(LINE)
        .lineWidth(1)
        .moveTo(MARGIN, doc.y)
        .lineTo(doc.page.width - MARGIN, doc.y)
        .stroke();
      doc.moveDown(0.4);
      for (const bloco of cap.blocos) {
        if (bloco.tipo === 'par') {
          doc.fillColor(INK).fontSize(9).font('Helvetica').text(bloco.texto, MARGIN, doc.y, {
            width,
            align: 'justify',
            paragraphGap: 4,
          });
        } else {
          this.tabela(doc, bloco, width);
        }
      }
    }

    // ── Evidência do aceite + encerramento ───────────────────────────────
    doc.moveDown(1.2);
    if (p.comercial.propostaAceita) {
      doc
        .fillColor(MUTED)
        .fontSize(8.5)
        .font('Helvetica-Oblique')
        .text(
          `Condições comerciais aceitas eletronicamente pela CONTRATANTE na proposta ` +
            `${p.comercial.propostaAceita.id.slice(-8).toUpperCase()} em ${p.comercial.propostaAceita.decididaEm}, ` +
            `registrada no Portal Avecchi (cláusula 40.4).`,
          MARGIN,
          doc.y,
          { width, align: 'justify' },
        );
      doc.moveDown(0.6);
    }
    doc
      .fillColor(INK)
      .fontSize(9)
      .font('Helvetica')
      .text(
        'E, por estarem justas e contratadas, as Partes firmam o presente instrumento eletronicamente, em via ' +
          'única digital, com plena validade jurídica.',
        MARGIN,
        doc.y,
        { width, align: 'justify' },
      );
    doc.moveDown(0.8);
    doc
      .fillColor(INK)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text(`${docContrato.localAssinatura}, na data da assinatura eletrônica.`, MARGIN, doc.y, { width });

    // ── Assinaturas ──────────────────────────────────────────────────────
    this.garantirEspaco(doc, 140);
    doc.moveDown(2.5);
    const y = doc.y;
    const col = (doc.page.width - MARGIN * 2) / 2 - 12;
    this.assinatura(doc, MARGIN, y, col, p.operadora.razaoSocial, p.operadora.cnpj, 'CONTRATADA');
    this.assinatura(doc, MARGIN + col + 24, y, col, p.cliente.razaoSocial, p.cliente.cnpj, 'CONTRATANTE');

    // ── Rodapé em todas as páginas ───────────────────────────────────────
    // Gotcha do pdfkit: escrever abaixo da margem inferior dispara addPage
    // automático — zera a margem durante o carimbo.
    const emitido = new Date().toLocaleDateString('pt-BR');
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .fillColor(MUTED)
        .fontSize(7.5)
        .font('Helvetica')
        .text(
          `${TEMPLATE_VERSION} · Documento eletrônico · avecchi.ai · emitido em ${emitido} · página ${i + 1} de ${range.count}`,
          MARGIN,
          doc.page.height - 40,
          { width: doc.page.width - MARGIN * 2, align: 'center', lineBreak: false },
        );
      doc.page.margins.bottom = bottom;
    }

    doc.end();
    return done;
  }

  /** Quebra de página preventiva quando o espaço restante é curto demais. */
  private garantirEspaco(doc: any, minimo: number) {
    if (doc.y + minimo > doc.page.height - doc.page.margins.bottom) doc.addPage();
  }

  /** Tabela simples com cabeçalho escuro, bordas e quebra de linha por célula. */
  private tabela(doc: any, bloco: Extract<Bloco, { tipo: 'tabela' }>, width: number) {
    const nCols = bloco.colunas.length;
    // primeira coluna mais estreita quando há 3+ colunas (rótulos curtos)
    const colWidths: number[] =
      nCols >= 3
        ? [width * 0.22, ...Array(nCols - 1).fill((width * 0.78) / (nCols - 1))]
        : Array(nCols).fill(width / nCols);
    const PAD = 5;
    const fontSize = nCols >= 4 ? 7.5 : 8.5;

    const alturaLinha = (celulas: string[], bold: boolean): number => {
      doc.fontSize(fontSize).font(bold ? 'Helvetica-Bold' : 'Helvetica');
      let h = 0;
      celulas.forEach((c, i) => {
        h = Math.max(h, doc.heightOfString(c, { width: colWidths[i] - PAD * 2 }));
      });
      return h + PAD * 2;
    };

    const desenharLinha = (celulas: string[], bold: boolean, headBg: boolean) => {
      const h = alturaLinha(celulas, bold);
      if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
      const y0 = doc.y;
      let x = MARGIN;
      if (headBg) {
        doc.rect(MARGIN, y0, width, h).fill(TABLE_HEAD_BG);
      }
      celulas.forEach((c, i) => {
        doc
          .fillColor(headBg ? '#FFFFFF' : INK)
          .fontSize(fontSize)
          .font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .text(c, x + PAD, y0 + PAD, { width: colWidths[i] - PAD * 2 });
        x += colWidths[i];
      });
      doc.strokeColor(LINE).lineWidth(0.5).rect(MARGIN, y0, width, h).stroke();
      doc.y = y0 + h;
      doc.x = MARGIN;
    };

    doc.moveDown(0.3);
    desenharLinha(bloco.colunas, true, true);
    for (const linha of bloco.linhas) desenharLinha(linha, false, false);
    doc.moveDown(0.4);
  }

  private assinatura(
    doc: any,
    x: number,
    y: number,
    width: number,
    nome: string,
    cnpj: string,
    papel: string,
  ) {
    doc
      .strokeColor(INK)
      .lineWidth(0.8)
      .moveTo(x, y + 36)
      .lineTo(x + width, y + 36)
      .stroke();
    doc.fillColor(INK).fontSize(8.5).font('Helvetica-Bold').text(nome, x, y + 41, { width, align: 'center' });
    doc
      .fillColor(MUTED)
      .fontSize(8)
      .font('Helvetica')
      .text(`CNPJ ${cnpj}`, x, doc.y + 1, { width, align: 'center' });
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text(papel, x, doc.y + 1, { width, align: 'center' });
    doc
      .fillColor(MUTED)
      .fontSize(8)
      .font('Helvetica')
      .text('Nome: ____________________________', x, doc.y + 8, { width, align: 'center' });
    doc
      .fillColor(MUTED)
      .fontSize(8)
      .font('Helvetica')
      .text('Cargo: ____________________________', x, doc.y + 2, { width, align: 'center' });
  }
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

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DEZ_A_DEZENOVE = [
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

function trioPorExtenso(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto >= 10 && resto < 20) {
    partes.push(DEZ_A_DEZENOVE[resto - 10]);
  } else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    if (d) partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    else if (u) partes.push(UNIDADES[u]);
  }
  return partes.join(' e ');
}

/**
 * Valor em reais por extenso (até centenas de milhões — suficiente para
 * mensalidade). Fora da faixa → null: o PDF mostra só o numérico, nunca um
 * extenso errado.
 */
export function reaisPorExtenso(cents: number): string | null {
  if (!Number.isInteger(cents) || cents < 0 || cents >= 100_000_000_000) return null;
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  const partes: string[] = [];

  const milhoes = Math.floor(reais / 1_000_000);
  const milhares = Math.floor((reais % 1_000_000) / 1000);
  const resto = reais % 1000;

  if (milhoes) partes.push(milhoes === 1 ? 'um milhão' : `${trioPorExtenso(milhoes)} milhões`);
  if (milhares) partes.push(milhares === 1 ? 'mil' : `${trioPorExtenso(milhares)} mil`);
  if (resto) partes.push(trioPorExtenso(resto));

  let texto = reais === 0 ? '' : `${partes.join(' e ')} ${reais === 1 ? 'real' : 'reais'}`;
  if (centavos) {
    const c = `${trioPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
    texto = texto ? `${texto} e ${c}` : c;
  }
  return texto || 'zero reais';
}
