import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { BinRegistrationStatus } from '@prisma/client';
import { CreateBinRegistrationDto, UpdateBinRegistrationDto } from './dto/bin-registration.dto';
import { BIN_REGISTERED_EVENT, BinRegisteredEvent } from './events/bin-registered.event';

@Injectable()
export class BinRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(companyId: string, dto: CreateBinRegistrationDto) {
    const sn = await this.prisma.serialNumber.findFirst({
      where: { id: dto.serialNumberId, companyId },
    });
    if (!sn) throw new NotFoundException(`SerialNumber ${dto.serialNumberId} não encontrado`);
    if (!sn.chassi) {
      throw new BadRequestException('SerialNumber sem chassi — preencha os dados veiculares antes de registrar na BIN');
    }
    // BIN exige peso real (#372): a NF-e aceita zero, mas o registro não
    if (!sn.pesoLiquido || Number(sn.pesoLiquido) <= 0 || !sn.pesoBruto || Number(sn.pesoBruto) <= 0) {
      throw new BadRequestException('pesoLiquido e pesoBruto devem ser > 0 para registro na BIN (#372)');
    }

    return this.prisma.binRegistration.create({
      data: {
        companyId,
        serialNumberId: dto.serialNumberId,
        binNumber: dto.binNumber,
        status: dto.status ?? BinRegistrationStatus.PENDING,
        notes: dto.notes,
        ...(dto.status === BinRegistrationStatus.SUBMITTED && { submittedAt: new Date() }),
        ...(dto.status === BinRegistrationStatus.REGISTERED && { registeredAt: new Date() }),
      },
    });
  }

  async findAll(companyId: string, status?: BinRegistrationStatus) {
    return this.prisma.binRegistration.findMany({
      where: { companyId, ...(status && { status }) },
      include: { serialNumber: { select: { serial: true, chassi: true, productId: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findBySerialNumber(serialNumberId: string, companyId: string) {
    const reg = await this.prisma.binRegistration.findFirst({
      where: { serialNumberId, companyId },
      include: { serialNumber: true },
    });
    if (!reg) throw new NotFoundException(`Registro BIN não encontrado para SerialNumber ${serialNumberId}`);
    return reg;
  }

  async update(id: string, companyId: string, dto: UpdateBinRegistrationDto) {
    const reg = await this.prisma.binRegistration.findFirst({ where: { id, companyId } });
    if (!reg) throw new NotFoundException(`Registro BIN ${id} não encontrado`);

    if (dto.status === BinRegistrationStatus.REJECTED && !dto.rejectionReason) {
      throw new BadRequestException('rejectionReason é obrigatório quando status=REJECTED');
    }

    const updated = await this.prisma.binRegistration.update({
      where: { id },
      data: {
        ...(dto.binNumber !== undefined && { binNumber: dto.binNumber }),
        ...(dto.status && { status: dto.status }),
        ...(dto.rejectionReason !== undefined && { rejectionReason: dto.rejectionReason }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.status === BinRegistrationStatus.SUBMITTED && !reg.submittedAt && { submittedAt: new Date() }),
        ...(dto.status === BinRegistrationStatus.REGISTERED && !reg.registeredAt && { registeredAt: new Date() }),
      },
    });

    // #365: BIN recém-registrada → avança a entrega da venda (AWAITING_PICKUP)
    if (dto.status === BinRegistrationStatus.REGISTERED && !reg.registeredAt) {
      this.eventEmitter.emit(BIN_REGISTERED_EVENT, new BinRegisteredEvent(companyId, reg.serialNumberId));
    }

    return updated;
  }

  /**
   * Chassis com dados veiculares mas sem BIN REGISTERED — visão de pendências
   * para o dashboard e alerta pré-faturamento (#362).
   */
  async findPendingChassis(companyId: string) {
    return this.prisma.serialNumber.findMany({
      where: {
        companyId,
        chassi: { not: null },
        OR: [
          { binRegistration: null },
          { binRegistration: { status: { notIn: [BinRegistrationStatus.REGISTERED] } } },
        ],
      },
      select: {
        id: true,
        serial: true,
        chassi: true,
        status: true,
        binRegistration: { select: { status: true, submittedAt: true, rejectionReason: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** true quando o chassi tem BIN REGISTERED — usado como alerta no faturamento */
  async isRegistered(serialNumberId: string): Promise<boolean> {
    // tenant-lint: ok (serialNumberId resolvido de pedido tenant-escopado pelo chamador)
    const reg = await this.prisma.binRegistration.findUnique({
      where: { serialNumberId },
      select: { status: true },
    });
    return reg?.status === BinRegistrationStatus.REGISTERED;
  }
}
