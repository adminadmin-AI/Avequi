import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { CreatePixChargeDto } from './dto/create-pix-charge.dto';
import { crc16 } from './pix/crc16';

export interface PixChargeFilters {
  status?: string;
  bankAccountId?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class PixService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── QR Code Payload Builder (EMV BRCode) ─────────────────────────────────

  /**
   * Builds an EMV TLV field: tag (2 chars) + length (2 chars) + value
   */
  private tlv(tag: string, value: string): string {
    const len = value.length.toString().padStart(2, '0');
    return `${tag}${len}${value}`;
  }

  /**
   * Generates an EMV Pix QR Code payload (BRCode format).
   * Tag 63 (CRC16) is appended at the end over the full string including "6304".
   */
  generateQrCodePayload(
    pixKey: string,
    merchantName: string,
    merchantCity: string,
    txId: string,
    amount: number,
  ): string {
    // Tag 26: Merchant Account Info
    const mai =
      this.tlv('00', 'br.gov.bcb.pix') +
      this.tlv('01', pixKey);
    const tag26 = this.tlv('26', mai);

    // Tag 62: Additional Data Field (subtag 05 = txId)
    const adf = this.tlv('05', txId);
    const tag62 = this.tlv('62', adf);

    // Amount — only include if non-zero
    const amountStr = amount.toFixed(2);
    const tag54 = amount > 0 ? this.tlv('54', amountStr) : '';

    const payload =
      this.tlv('00', '01') +      // Payload Format Indicator
      tag26 +                      // Merchant Account Info
      this.tlv('52', '0000') +     // Merchant Category Code
      this.tlv('53', '986') +      // Transaction Currency (BRL)
      tag54 +                      // Transaction Amount
      this.tlv('58', 'BR') +       // Country Code
      this.tlv('59', merchantName.substring(0, 25)) + // Merchant Name (max 25)
      this.tlv('60', merchantCity.substring(0, 15)) + // Merchant City (max 15)
      tag62 +                      // Additional Data
      '6304';                      // CRC16 tag + length placeholder

    const crc = crc16(payload);
    return payload + crc;
  }

  // ─── Create Pix Charge ─────────────────────────────────────────────────────

  async generateStaticQrCode(companyId: string, dto: CreatePixChargeDto) {
    // Verify bank account
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, companyId },
      include: { company: true },
    });
    if (!bankAccount) {
      throw new BusinessException(
        'Conta bancária não encontrada',
        HttpStatus.NOT_FOUND,
      );
    }

    // Verify receivable if provided
    if (dto.receivableId) {
      const receivable = await this.prisma.receivable.findFirst({
        where: { id: dto.receivableId, companyId },
      });
      if (!receivable) {
        throw new BusinessException(
          'Título a receber não encontrado',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    // Generate unique txId (up to 25 chars per Pix spec)
    const txId = this.generateTxId();

    const merchantName = bankAccount.company.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .substring(0, 25)
      .toUpperCase();

    const merchantCity = 'SAO PAULO'; // default — could be enriched from company data

    const qrCode = this.generateQrCodePayload(
      dto.pixKey,
      merchantName,
      merchantCity,
      txId,
      dto.amount,
    );

    const pixCharge = await this.prisma.pixCharge.create({
      data: {
        companyId,
        bankAccountId: dto.bankAccountId,
        receivableId: dto.receivableId ?? null,
        txId,
        amount: dto.amount,
        description: dto.description ?? null,
        pixKey: dto.pixKey,
        qrCode,
        status: 'ACTIVE',
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    return { txId, qrCode, pixCharge };
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  async findAll(companyId: string, filters: PixChargeFilters = {}) {
    const { status, bankAccountId, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { companyId };
    if (status) where.status = status;
    if (bankAccountId) where.bankAccountId = bankAccountId;

    const [items, total] = await Promise.all([
      this.prisma.pixCharge.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.pixCharge.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  // ─── Detail ────────────────────────────────────────────────────────────────

  async findOne(companyId: string, id: string) {
    const charge = await this.prisma.pixCharge.findFirst({
      where: { id, companyId },
      include: { bankAccount: true, receivable: true },
    });
    if (!charge) {
      throw new BusinessException(
        'Cobrança Pix não encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    return charge;
  }

  // ─── Cancel ────────────────────────────────────────────────────────────────

  async cancelCharge(companyId: string, id: string) {
    const charge = await this.findOne(companyId, id);
    if (charge.status === 'PAID') {
      throw new BusinessException(
        'Cobrança já liquidada não pode ser cancelada',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (charge.status === 'CANCELLED') {
      throw new BusinessException(
        'Cobrança já está cancelada',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return this.prisma.pixCharge.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  // ─── Mark as Paid (webhook) ────────────────────────────────────────────────

  async markAsPaid(
    companyId: string,
    txId: string,
    paidAmount: number,
    e2eId: string,
  ) {
    const charge = await this.prisma.pixCharge.findFirst({
      where: { txId, companyId },
    });
    if (!charge) {
      throw new BusinessException(
        'Cobrança Pix não encontrada para o txId informado',
        HttpStatus.NOT_FOUND,
      );
    }
    if (charge.status === 'PAID') {
      return charge; // idempotent
    }

    return this.prisma.pixCharge.update({
      where: { id: charge.id },
      data: {
        status: 'PAID',
        paidAmount,
        paidAt: new Date(),
        e2eId,
      },
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private generateTxId(): string {
    // Pix spec: up to 25 alphanumeric chars
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `${timestamp}${random}`.substring(0, 25);
  }
}
