import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SupplierService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSupplierDto, user: { id?: string; companyId: string }) {
    // companyId SEMPRE vem do JWT do usuário autenticado (nunca do body)
    const companyId = user.companyId;

    // Check CNPJ uniqueness per company
    if (dto.cnpj) {
      const existing = await this.prisma.supplier.findUnique({
        where: { companyId_cnpj: { companyId, cnpj: dto.cnpj } },
      });
      if (existing) {
        throw new ConflictException(`CNPJ '${dto.cnpj}' já cadastrado para esta empresa`);
      }
    }

    const supplier = await this.prisma.supplier.create({
      data: { ...dto, companyId },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'Supplier',
        action: 'CREATE',
        payload: { ...dto },
      },
    });

    return supplier;
  }

  async findAll(
    companyId: string,
    query: { search?: string; isActive?: string },
  ) {
    const where: any = { companyId };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { cnpj: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.supplier.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, companyId },
    });
    if (!supplier) throw new NotFoundException(`Fornecedor ${id} não encontrado`);
    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto, user: { id?: string; companyId: string }) {
    // Busca escopada pela empresa do usuário — impede editar fornecedor de outro tenant
    const existing = await this.prisma.supplier.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!existing) throw new NotFoundException(`Fornecedor ${id} não encontrado`);

    // companyId é imutável: registro nunca muda de empresa via update
    const companyId = existing.companyId;

    // Defesa em profundidade: descarta qualquer companyId injetado no payload
    const { companyId: _ignored, ...data } = dto as any;

    // ── Anti-fraude (#864): rastreia mudanças nos DADOS BANCÁRIOS ────────────
    // Diff antes→depois dos campos de pagamento. "Troca" = já havia valor e ele
    // mudou (A→B) — é o vetor do golpe da chave trocada. Primeiro preenchimento
    // (vazio→A, ex.: captura inteligente #863) NÃO conta como troca (decisão
    // do Rafael, 31/07). Trocas geram alerta no sino e acendem o aviso de
    // 15 dias na tela de contas a pagar (GET /finance/entries/:id/banking-alert).
    const BANKING_FIELDS = ['pixKey', 'bankName', 'bankAgency', 'bankAccount'] as const;
    const bankingChanges: Record<string, { from: string | null; to: string | null }> = {};
    let troca = false;
    for (const f of BANKING_FIELDS) {
      const next = (dto as Record<string, unknown>)[f];
      if (next === undefined) continue;
      const to = (next as string | null) || null;
      const from = existing[f] ?? null;
      if (to !== from) {
        bankingChanges[f] = { from, to };
        if (from) troca = true; // tinha valor antes → troca real
      }
    }

    const supplier = await this.prisma.supplier.update({
      where: { id },
      data,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'Supplier',
        action: 'UPDATE',
        payload: { ...dto },
      },
    });

    if (Object.keys(bankingChanges).length > 0) {
      // registro dedicado, consultável pelo alerta da tela (payload.id + troca)
      await this.prisma.auditLog.create({
        data: {
          userId: user?.id,
          companyId,
          entity: 'Supplier',
          action: 'BANKING_UPDATE',
          payload: { id, changes: bankingChanges, troca },
        },
      });
      if (troca) {
        // sino: avisa a empresa NA HORA, independente de alguém abrir a conta
        const campos = Object.keys(bankingChanges)
          .map((f) => (f === 'pixKey' ? 'chave PIX' : f))
          .join(', ');
        await this.prisma.alert.create({
          data: {
            companyId,
            type: 'SUPPLIER_BANKING_CHANGED',
            severity: 'WARNING',
            title: `Dados bancários alterados: ${existing.name}`,
            body:
              `${campos} do fornecedor ${existing.name} foram ALTERADOS. ` +
              'Antes de pagar títulos dele, confirme os novos dados por outro canal (golpe da chave trocada).',
            entityId: id,
            entityType: 'Supplier',
          },
        });
      }
    }

    return supplier;
  }
}
