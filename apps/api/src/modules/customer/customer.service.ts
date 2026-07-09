import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, CustomerAddressDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/** Produtor rural e contribuinte exigem IE numérica (#474) — evita rejeição SEFAZ 728/234 */
function validateFiscalConsistency(dto: { indIeDest?: string | null; isRuralProducer?: boolean; ie?: string | null }) {
  const ieNumerica = dto.ie && /^\d+$/.test(dto.ie.replace(/[.\-\/ ]/g, ''));
  if (dto.isRuralProducer && !ieNumerica) {
    throw new BadRequestException('Produtor rural exige IE de produtor preenchida (numérica)');
  }
  if (dto.indIeDest === 'CONTRIBUINTE' && !ieNumerica) {
    throw new BadRequestException('Cliente contribuinte de ICMS exige IE válida (numérica)');
  }
}

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCustomerDto, user: { id?: string; companyId: string }) {
    // companyId SEMPRE vem do JWT do usuário autenticado (nunca do body)
    const companyId = user.companyId;

    // Check document uniqueness per company
    if (dto.document) {
      const existing = await this.prisma.customer.findUnique({
        where: {
          companyId_document: { companyId, document: dto.document },
        },
      });
      if (existing) {
        throw new ConflictException(`Documento '${dto.document}' já cadastrado para esta empresa`);
      }
    }

    validateFiscalConsistency(dto);

    const customer = await this.prisma.customer.create({
      data: { ...dto, companyId },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'Customer',
        action: 'CREATE',
        payload: { ...dto },
      },
    });

    return customer;
  }

  async findAll(
    companyId: string,
    query: { search?: string; type?: string; isActive?: string; tagId?: string },
  ) {
    const where: any = { companyId };

    // #476: segmentação — só clientes com a tag
    if (query.tagId) {
      where.tagLinks = { some: { tagId: query.tagId } };
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { document: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.customer.findMany({
      where,
      include: { tagLinks: { include: { tag: true } } }, // #476 — chips na listagem
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── #476: tags de segmentação ─────────────────────────────────────────────

  /** Tags da company com contagem de clientes (contadores do dashboard) */
  listTags(companyId: string) {
    return this.prisma.customerTag.findMany({
      where: { companyId },
      include: { _count: { select: { links: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createTag(companyId: string, dto: { name: string; color?: string }) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Nome da tag é obrigatório');
    try {
      return await this.prisma.customerTag.create({
        data: { companyId, name, color: dto.color ?? null },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException(`Tag "${name}" já existe`);
      throw e;
    }
  }

  async deleteTag(companyId: string, tagId: string) {
    const tag = await this.prisma.customerTag.findFirst({ where: { id: tagId, companyId } });
    if (!tag) throw new NotFoundException('Tag não encontrada');
    // links caem por cascade
    await this.prisma.customerTag.delete({ where: { id: tagId } });
    return { deleted: true };
  }

  /** Substitui o conjunto de tags do cliente (idempotente) */
  async setCustomerTags(companyId: string, customerId: string, tagIds: string[]) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, companyId } });
    if (!customer) throw new NotFoundException('Cliente não encontrado');

    // tenancy: só tags da mesma company entram
    const valid = await this.prisma.customerTag.findMany({
      where: { id: { in: tagIds }, companyId },
      select: { id: true },
    });
    const validIds = valid.map((t) => t.id);

    await this.prisma.$transaction([
      this.prisma.customerTagLink.deleteMany({ where: { customerId } }),
      this.prisma.customerTagLink.createMany({
        data: validIds.map((tagId) => ({ customerId, tagId })),
        skipDuplicates: true,
      }),
    ]);
    return this.prisma.customerTagLink.findMany({
      where: { customerId },
      include: { tag: true },
    });
  }

  // ─── #476: anexos (docs de emplacamento — CNH, comprovante etc.) ───────────

  private static readonly MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB

  /** Lista SÓ metadados — o binário sai no download */
  async listAttachments(companyId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, companyId } });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    return this.prisma.customerAttachment.findMany({
      where: { customerId },
      select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addAttachment(
    companyId: string,
    customerId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    uploadedById?: string,
  ) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, companyId } });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    if (file.size > CustomerService.MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException('Anexo excede o limite de 10MB');
    }
    const created = await this.prisma.customerAttachment.create({
      data: {
        companyId,
        customerId,
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        data: file.buffer,
        uploadedById: uploadedById ?? null,
      },
      select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
    });
    return created;
  }

  async getAttachment(companyId: string, attachmentId: string) {
    const att = await this.prisma.customerAttachment.findFirst({
      where: { id: attachmentId, companyId },
    });
    if (!att) throw new NotFoundException('Anexo não encontrado');
    return att;
  }

  async deleteAttachment(companyId: string, attachmentId: string) {
    const att = await this.prisma.customerAttachment.findFirst({
      where: { id: attachmentId, companyId },
      select: { id: true },
    });
    if (!att) throw new NotFoundException('Anexo não encontrado');
    await this.prisma.customerAttachment.delete({ where: { id: attachmentId } });
    return { deleted: true };
  }

  async findOne(id: string, companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
      include: { addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] } },
    });
    if (!customer) throw new NotFoundException(`Cliente ${id} não encontrado`);
    return customer;
  }

  // ─── Endereços de entrega 1:N (#474) ────────────────────────────────────────

  async addAddress(customerId: string, dto: CustomerAddressDto, companyId: string) {
    await this.findOne(customerId, companyId); // valida tenant
    if (dto.isDefault) {
      await this.prisma.customerAddress.updateMany({ where: { customerId }, data: { isDefault: false } });
    }
    return this.prisma.customerAddress.create({ data: { ...dto, customerId } });
  }

  async updateAddress(customerId: string, addressId: string, dto: Partial<CustomerAddressDto>, companyId: string) {
    await this.findOne(customerId, companyId);
    const addr = await this.prisma.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!addr) throw new NotFoundException(`Endereço ${addressId} não encontrado`);
    if (dto.isDefault) {
      await this.prisma.customerAddress.updateMany({ where: { customerId }, data: { isDefault: false } });
    }
    return this.prisma.customerAddress.update({ where: { id: addressId }, data: dto });
  }

  async removeAddress(customerId: string, addressId: string, companyId: string) {
    await this.findOne(customerId, companyId);
    const addr = await this.prisma.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!addr) throw new NotFoundException(`Endereço ${addressId} não encontrado`);
    const inUse = await this.prisma.salesOrder.count({ where: { deliveryAddressId: addressId } });
    if (inUse > 0) {
      throw new ConflictException('Endereço usado em vendas — não pode ser excluído');
    }
    return this.prisma.customerAddress.delete({ where: { id: addressId } });
  }

  async update(id: string, dto: UpdateCustomerDto, user: { id?: string; companyId: string }) {
    // Busca escopada pela empresa do usuário — impede editar cliente de outro tenant
    const existing = await this.prisma.customer.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!existing) throw new NotFoundException(`Cliente ${id} não encontrado`);

    // companyId é imutável: registro nunca muda de empresa via update
    const companyId = existing.companyId;

    // Defesa em profundidade: descarta qualquer companyId injetado no payload
    const { companyId: _ignored, ...data } = dto as any;

    validateFiscalConsistency({
      indIeDest: data.indIeDest ?? existing.indIeDest,
      isRuralProducer: data.isRuralProducer ?? existing.isRuralProducer,
      ie: data.ie !== undefined ? data.ie : existing.ie,
    });

    // #388: mudança em limite/score é decisão de crédito — registra quem/quando
    const creditChanged =
      (data.creditLimit !== undefined && Number(data.creditLimit ?? 0) !== Number(existing.creditLimit ?? 0)) ||
      (data.creditScore !== undefined && data.creditScore !== (existing as any).creditScore);
    if (creditChanged) {
      data.creditApprovedById = user.id ?? null;
      data.creditApprovedAt = new Date();
      data.lastCreditReview = new Date();
    }

    const customer = await this.prisma.customer.update({
      where: { id },
      data,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'Customer',
        action: 'UPDATE',
        payload: { ...dto },
      },
    });

    return customer;
  }

  /** #475 — situação de crédito: limite, em aberto (Receivable OPEN/OVERDUE) e disponível */
  async creditStatus(id: string, companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        name: true,
        creditLimit: true,
        billingBlocked: true,
        billingBlockReason: true,
        creditScore: true,
        creditApprovedById: true,
        creditApprovedAt: true,
        creditNotes: true,
        lastCreditReview: true,
      },
    });
    if (!customer) throw new NotFoundException(`Cliente ${id} não encontrado`);
    // Em aberto vive em FinancialEntry (AUTO_SALES) — ver nota no sales.service (#475)
    const open = await this.prisma.financialEntry.aggregate({
      where: {
        companyId,
        type: 'RECEIVABLE' as any,
        status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] as any },
        salesOrder: { customerId: id },
        // #586: cartão autorizado é dívida da ADQUIRENTE — não consome limite
        debtorType: 'CUSTOMER' as any,
      },
      _sum: { amount: true },
    });
    const openReceivables = Number(open._sum.amount ?? 0);
    const creditLimit = customer.creditLimit ? Number(customer.creditLimit) : null;
    return {
      customerId: customer.id,
      name: customer.name,
      creditLimit,
      openReceivables,
      available: creditLimit != null ? Math.max(0, creditLimit - openReceivables) : null,
      overLimit: creditLimit != null && openReceivables > creditLimit,
      billingBlocked: (customer as any).billingBlocked,
      billingBlockReason: (customer as any).billingBlockReason,
      // #388 — política de crédito
      creditScore: (customer as any).creditScore ?? null,
      creditApprovedById: (customer as any).creditApprovedById ?? null,
      creditApprovedAt: (customer as any).creditApprovedAt ?? null,
      creditNotes: (customer as any).creditNotes ?? null,
      lastCreditReview: (customer as any).lastCreditReview ?? null,
    };
  }

}
