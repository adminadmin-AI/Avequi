import { Injectable, NotFoundException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { CreateBoletoDto } from './dto/create-boleto.dto';
import { UpdateBoletoDto } from './dto/update-boleto.dto';
import { BoletoStatus } from '../../generated/prisma';

export interface FindAllBoletosOptions {
  status?: BoletoStatus;
  bankAccountId?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class BoletoService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateBoletoDto) {
    // Verify bank account belongs to company
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, companyId },
    });
    if (!bankAccount) {
      throw new BusinessException(
        'Conta bancária não encontrada',
        HttpStatus.NOT_FOUND,
      );
    }

    // Verify receivable belongs to company (if provided)
    if (dto.receivableId) {
      const receivable = await this.prisma.receivable.findFirst({
        where: { id: dto.receivableId, companyId },
      });
      if (!receivable) {
        throw new BusinessException(
          'Recebível não encontrado',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    // Check nossoNumero uniqueness within bankAccount
    const existing = await this.prisma.boleto.findUnique({
      where: {
        bankAccountId_nossoNumero: {
          bankAccountId: dto.bankAccountId,
          nossoNumero: dto.nossoNumero,
        },
      },
    });
    if (existing) {
      throw new BusinessException(
        `Nosso número '${dto.nossoNumero}' já existe nessa conta bancária`,
      );
    }

    return this.prisma.boleto.create({
      data: {
        companyId,
        bankAccountId: dto.bankAccountId,
        receivableId: dto.receivableId,
        nossoNumero: dto.nossoNumero,
        seuNumero: dto.seuNumero,
        amount: dto.amount,
        dueDate: new Date(dto.dueDate),
        payerName: dto.payerName,
        payerDocument: dto.payerDocument,
        payerAddress: dto.payerAddress,
        payerCity: dto.payerCity,
        payerState: dto.payerState,
        payerZipCode: dto.payerZipCode,
        instructions: dto.instructions,
      },
      include: { bankAccount: true, receivable: true },
    });
  }

  async findAll(
    companyId: string,
    options: FindAllBoletosOptions = {},
  ) {
    const { status, bankAccountId, page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { companyId };
    if (status) where.status = status;
    if (bankAccountId) where.bankAccountId = bankAccountId;

    const [data, total] = await Promise.all([
      this.prisma.boleto.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { bankAccount: { select: { id: true, name: true, bankCode: true } } },
      }),
      this.prisma.boleto.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(companyId: string, id: string) {
    const boleto = await this.prisma.boleto.findFirst({
      where: { id, companyId },
      include: {
        bankAccount: true,
        receivable: true,
        remessaItems: { include: { remessa: true } },
        retornoItems: true,
      },
    });
    if (!boleto) {
      throw new BusinessException('Boleto não encontrado', HttpStatus.NOT_FOUND);
    }
    return boleto;
  }

  async update(companyId: string, id: string, dto: UpdateBoletoDto) {
    const boleto = await this.prisma.boleto.findFirst({
      where: { id, companyId },
    });
    if (!boleto) {
      throw new BusinessException('Boleto não encontrado', HttpStatus.NOT_FOUND);
    }
    if (boleto.status === BoletoStatus.CANCELLED) {
      throw new BusinessException('Boleto cancelado não pode ser alterado');
    }

    const updateData: Record<string, unknown> = {};
    if (dto.nossoNumero !== undefined) updateData.nossoNumero = dto.nossoNumero;
    if (dto.seuNumero !== undefined) updateData.seuNumero = dto.seuNumero;
    if (dto.amount !== undefined) updateData.amount = dto.amount;
    if (dto.dueDate !== undefined) updateData.dueDate = new Date(dto.dueDate);
    if (dto.payerName !== undefined) updateData.payerName = dto.payerName;
    if (dto.payerDocument !== undefined) updateData.payerDocument = dto.payerDocument;
    if (dto.payerAddress !== undefined) updateData.payerAddress = dto.payerAddress;
    if (dto.payerCity !== undefined) updateData.payerCity = dto.payerCity;
    if (dto.payerState !== undefined) updateData.payerState = dto.payerState;
    if (dto.payerZipCode !== undefined) updateData.payerZipCode = dto.payerZipCode;
    if (dto.instructions !== undefined) updateData.instructions = dto.instructions;

    return this.prisma.boleto.update({
      where: { id },
      data: updateData,
      include: { bankAccount: true, receivable: true },
    });
  }

  async cancel(companyId: string, id: string) {
    const boleto = await this.prisma.boleto.findFirst({
      where: { id, companyId },
    });
    if (!boleto) {
      throw new BusinessException('Boleto não encontrado', HttpStatus.NOT_FOUND);
    }
    if (boleto.status === BoletoStatus.PAID) {
      throw new BusinessException('Boleto já pago não pode ser cancelado');
    }
    if (boleto.status === BoletoStatus.CANCELLED) {
      throw new BusinessException('Boleto já está cancelado');
    }

    return this.prisma.boleto.update({
      where: { id },
      data: { status: BoletoStatus.CANCELLED, cancelledAt: new Date() },
    });
  }
}
