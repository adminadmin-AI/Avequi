import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AtpveStatus, BinRegistrationStatus } from '@prisma/client';
import { CreateAtpveDto, UpdateAtpveDto } from './dto/atpve.dto';

@Injectable()
export class AtpveService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateAtpveDto) {
    const sn = await this.prisma.serialNumber.findFirst({
      where: { id: dto.serialNumberId, companyId },
      include: { binRegistration: { select: { status: true } } },
    });
    if (!sn) throw new NotFoundException(`SerialNumber ${dto.serialNumberId} não encontrado`);

    const so = await this.prisma.salesOrder.findFirst({
      where: { id: dto.salesOrderId, companyId },
    });
    if (!so) throw new NotFoundException(`SalesOrder ${dto.salesOrderId} não encontrada`);

    // Fluxo RENAVE: pré-cadastro BIN é pré-requisito do ATPV-e (#362 → #363)
    if (sn.binRegistration?.status !== BinRegistrationStatus.REGISTERED) {
      throw new BadRequestException(
        `Chassi ${sn.chassi ?? sn.serial} sem registro BIN REGISTERED — o ATPV-e só pode ser emitido após o pré-cadastro na BIN`,
      );
    }

    // Um ATPV-e ativo por chassi (reemissão só após cancelamento)
    const active = await this.prisma.atpveRecord.findFirst({
      where: { serialNumberId: dto.serialNumberId, status: { not: AtpveStatus.CANCELLED } },
    });
    if (active) {
      throw new BadRequestException(`Já existe ATPV-e ativo (${active.status}) para este chassi`);
    }

    return this.prisma.atpveRecord.create({
      data: {
        companyId,
        serialNumberId: dto.serialNumberId,
        salesOrderId: dto.salesOrderId,
        clienteCpf: dto.clienteCpf,
        clienteNome: dto.clienteNome,
        atpveNumber: dto.atpveNumber,
        status: dto.status ?? AtpveStatus.PENDING,
        issuedBy: dto.issuedBy,
        notes: dto.notes,
        ...(dto.status === AtpveStatus.ISSUED && { issuedAt: new Date() }),
      },
    });
  }

  async findAll(companyId: string, status?: AtpveStatus) {
    return this.prisma.atpveRecord.findMany({
      where: { companyId, ...(status && { status }) },
      include: {
        serialNumber: { select: { serial: true, chassi: true } },
        salesOrder: { select: { id: true, customer: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const rec = await this.prisma.atpveRecord.findFirst({
      where: { id, companyId },
      include: { serialNumber: true, salesOrder: { include: { customer: true } } },
    });
    if (!rec) throw new NotFoundException(`ATPV-e ${id} não encontrado`);
    return rec;
  }

  async update(id: string, companyId: string, dto: UpdateAtpveDto) {
    const rec = await this.prisma.atpveRecord.findFirst({ where: { id, companyId } });
    if (!rec) throw new NotFoundException(`ATPV-e ${id} não encontrado`);

    return this.prisma.atpveRecord.update({
      where: { id },
      data: {
        ...(dto.atpveNumber !== undefined && { atpveNumber: dto.atpveNumber }),
        ...(dto.status && { status: dto.status }),
        ...(dto.clienteCpf && { clienteCpf: dto.clienteCpf }),
        ...(dto.clienteNome && { clienteNome: dto.clienteNome }),
        ...(dto.issuedBy !== undefined && { issuedBy: dto.issuedBy }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.status === AtpveStatus.ISSUED && !rec.issuedAt && { issuedAt: new Date() }),
      },
    });
  }

  /** Vendas faturadas de itens serializados sem ATPV-e ISSUED — visão de pendências (#363) */
  async findSalesWithoutAtpve(companyId: string) {
    return this.prisma.serialNumber.findMany({
      where: {
        companyId,
        chassi: { not: null },
        salesOrderId: { not: null },
        atpveRecords: { none: { status: AtpveStatus.ISSUED } },
      },
      select: {
        id: true,
        serial: true,
        chassi: true,
        soldAt: true,
        salesOrderId: true,
        salesOrder: { select: { customer: { select: { name: true } } } },
        atpveRecords: { select: { status: true, createdAt: true } },
      },
      orderBy: { soldAt: 'desc' },
    });
  }
}
