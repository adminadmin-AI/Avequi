import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, PaymentModality } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAcquirerDto } from './dto/create-acquirer.dto';
import { UpdateAcquirerDto } from './dto/update-acquirer.dto';
import { CreateAcquirerFeeDto } from './dto/create-acquirer-fee.dto';
import { UpdateAcquirerFeeDto } from './dto/update-acquirer-fee.dto';

export interface ResolvedFee {
  feeId: string;
  mdrRate: number;
  settlementDays: number;
}

/** Adquirentes de cartão + tabela de taxas MDR/prazo de liquidação (#585) */
@Injectable()
export class AcquirerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Modalidade da tabela de taxas a partir da forma + parcelas (#584) */
  static modalityFor(method: PaymentMethod, installments: number): PaymentModality | null {
    if (method === PaymentMethod.CARTAO_DEBITO) return PaymentModality.DEBITO;
    if (method === PaymentMethod.CARTAO_CREDITO || method === PaymentMethod.CARTAO) {
      return installments > 1 ? PaymentModality.CREDITO_PARCELADO : PaymentModality.CREDITO_AVISTA;
    }
    return null; // formas sem adquirente (PIX, boleto, dinheiro...)
  }

  // ─── Adquirentes ──────────────────────────────────────────────────────────

  async create(dto: CreateAcquirerDto, user: { id?: string; companyId: string }) {
    // companyId SEMPRE vem do JWT do usuário autenticado (nunca do body)
    const companyId = user.companyId;

    const existing = await this.prisma.acquirer.findUnique({
      where: { companyId_name: { companyId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(`Adquirente '${dto.name}' já cadastrada para esta empresa`);
    }

    const acquirer = await this.prisma.acquirer.create({
      data: { ...dto, companyId },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'Acquirer',
        action: 'CREATE',
        payload: { ...dto },
      },
    });

    return acquirer;
  }

  async findAll(companyId: string, query: { search?: string; isActive?: string }) {
    const where: any = { companyId };
    if (query.isActive !== undefined) where.isActive = query.isActive === 'true';
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { cnpj: { contains: query.search } },
      ];
    }
    return this.prisma.acquirer.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { fees: { where: { isActive: true }, orderBy: [{ modality: 'asc' }, { installmentsFrom: 'asc' }] } },
    });
  }

  async findOne(id: string, companyId: string) {
    const acquirer = await this.prisma.acquirer.findFirst({
      where: { id, companyId },
      include: { fees: { orderBy: [{ modality: 'asc' }, { installmentsFrom: 'asc' }] } },
    });
    if (!acquirer) throw new NotFoundException(`Adquirente ${id} não encontrada`);
    return acquirer;
  }

  async update(id: string, dto: UpdateAcquirerDto, user: { id?: string; companyId: string }) {
    // Busca escopada pela empresa do usuário — impede editar registro de outro tenant
    const existing = await this.prisma.acquirer.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!existing) throw new NotFoundException(`Adquirente ${id} não encontrada`);

    // Defesa em profundidade: descarta qualquer companyId injetado no payload
    const { companyId: _ignored, ...data } = dto as any;

    const acquirer = await this.prisma.acquirer.update({ where: { id }, data });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId: existing.companyId,
        entity: 'Acquirer',
        action: 'UPDATE',
        payload: { acquirerId: id, ...data },
      },
    });

    return acquirer;
  }

  // ─── Taxas (MDR + prazo de liquidação) ────────────────────────────────────

  async addFee(acquirerId: string, dto: CreateAcquirerFeeDto, user: { id?: string; companyId: string }) {
    await this.findOne(acquirerId, user.companyId); // valida tenancy

    const from = dto.installmentsFrom ?? 1;
    const to = dto.installmentsTo ?? from;
    if (to < from) {
      throw new BadRequestException('installmentsTo deve ser >= installmentsFrom');
    }
    this.assertValidWindow(dto.validFrom, dto.validTo);

    const fee = await this.prisma.acquirerFee.create({
      data: {
        acquirerId,
        brand: dto.brand?.toUpperCase() ?? null,
        modality: dto.modality,
        installmentsFrom: from,
        installmentsTo: to,
        mdrRate: dto.mdrRate,
        settlementDays: dto.settlementDays,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validTo: dto.validTo ? new Date(dto.validTo) : null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId: user.companyId,
        entity: 'AcquirerFee',
        action: 'CREATE',
        payload: { acquirerId, feeId: fee.id, ...dto },
      },
    });

    return fee;
  }

  async updateFee(feeId: string, dto: UpdateAcquirerFeeDto, user: { id?: string; companyId: string }) {
    const existing = await this.prisma.acquirerFee.findFirst({
      where: { id: feeId, acquirer: { companyId: user.companyId } },
    });
    if (!existing) throw new NotFoundException(`Taxa ${feeId} não encontrada`);

    const from = dto.installmentsFrom ?? existing.installmentsFrom;
    const to = dto.installmentsTo ?? existing.installmentsTo;
    if (to < from) {
      throw new BadRequestException('installmentsTo deve ser >= installmentsFrom');
    }
    this.assertValidWindow(
      dto.validFrom ?? existing.validFrom?.toISOString(),
      dto.validTo ?? existing.validTo?.toISOString(),
    );

    const { companyId: _ignored, acquirerId: _ignored2, ...data } = dto as any;

    const fee = await this.prisma.acquirerFee.update({
      where: { id: feeId },
      data: {
        ...data,
        ...(dto.brand !== undefined ? { brand: dto.brand?.toUpperCase() ?? null } : {}),
        ...(dto.validFrom !== undefined ? { validFrom: dto.validFrom ? new Date(dto.validFrom) : null } : {}),
        ...(dto.validTo !== undefined ? { validTo: dto.validTo ? new Date(dto.validTo) : null } : {}),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId: user.companyId,
        entity: 'AcquirerFee',
        action: 'UPDATE',
        payload: { feeId, ...data },
      },
    });

    return fee;
  }

  /**
   * Resolve a taxa vigente: (adquirente, bandeira, modalidade, parcelas, data)
   * → { mdrRate, settlementDays }. Bandeira exata vence regra genérica (null);
   * empate = vigência mais recente. Fonte da verdade do líquido/data (#585).
   */
  async resolveFee(
    companyId: string,
    params: {
      acquirerId: string;
      brand?: string;
      modality: PaymentModality;
      installments: number;
      date?: Date;
    },
  ): Promise<ResolvedFee | null> {
    const date = params.date ?? new Date();
    const brand = params.brand?.toUpperCase();

    const fees = await this.prisma.acquirerFee.findMany({
      where: {
        acquirerId: params.acquirerId,
        acquirer: { companyId, isActive: true }, // tenancy pela relação
        isActive: true,
        modality: params.modality,
        installmentsFrom: { lte: params.installments },
        installmentsTo: { gte: params.installments },
        OR: brand ? [{ brand }, { brand: null }] : [{ brand: null }],
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: date } }] },
          { OR: [{ validTo: null }, { validTo: { gte: date } }] },
        ],
      },
    });
    if (fees.length === 0) return null;

    // bandeira exata > genérica; depois faixa de parcelas mais específica
    // (mais estreita); por fim vigência mais recente.
    fees.sort((a, b) => {
      const brandScore = (f: { brand: string | null }) => (f.brand ? 1 : 0);
      if (brandScore(b) !== brandScore(a)) return brandScore(b) - brandScore(a);
      const span = (f: { installmentsFrom: number; installmentsTo: number }) =>
        f.installmentsTo - f.installmentsFrom;
      if (span(a) !== span(b)) return span(a) - span(b); // faixa menor vence
      const vf = (f: { validFrom: Date | null }) => f.validFrom?.getTime() ?? 0;
      return vf(b) - vf(a);
    });

    const best = fees[0];
    return {
      feeId: best.id,
      mdrRate: Number(best.mdrRate),
      settlementDays: best.settlementDays,
    };
  }

  private assertValidWindow(validFrom?: string | null, validTo?: string | null) {
    if (validFrom && validTo && new Date(validTo) < new Date(validFrom)) {
      throw new BadRequestException('validTo deve ser >= validFrom');
    }
  }
}
