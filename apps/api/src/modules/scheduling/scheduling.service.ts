import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Backward scheduling: sequencia OPs por data de entrega do cliente (mais urgente primeiro).
   * Considera capacidade do WorkCenter (horas/dia).
   */
  async generateSchedule(companyId: string, workCenterId: string) {
    // Buscar OPs pendentes ordenadas por scheduledEnd (mais urgente primeiro)
    const orders = await this.prisma.productionOrder.findMany({
      where: {
        companyId,
        status: { in: ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'] },
      },
      include: { product: true, items: true },
      orderBy: { scheduledEnd: 'asc' },
    });

    // Buscar capacidade do WorkCenter
    const wc = await this.prisma.workCenter.findFirst({
      where: { companyId, id: workCenterId },
    });
    if (!wc) throw new NotFoundException('WorkCenter não encontrado');

    const hoursPerDay = Number(wc.capacityHoursPerDay) * (Number(wc.efficiencyPct) / 100);
    const minutesPerDay = hoursPerDay * 60;

    // Limpar schedule anterior deste WorkCenter
    await this.prisma.productionSchedule.deleteMany({
      where: { companyId, workCenterId },
    });

    let currentDate = new Date();
    currentDate.setHours(8, 0, 0, 0); // Início do expediente
    let minutesUsedToday = 0;
    let sequence = 1;

    const schedules = [];

    for (const op of orders) {
      // Estimar duração: 60min por unidade (simplificado)
      const qty = Number(op.plannedQty) - Number(op.producedQty);
      if (qty <= 0) continue;

      const durationMinutes = Math.max(qty * 60, 30); // mínimo 30min
      const startDate = new Date(currentDate);

      // Verificar se cabe no dia
      if (minutesUsedToday + durationMinutes > minutesPerDay) {
        // Próximo dia útil
        currentDate.setDate(currentDate.getDate() + 1);
        if (currentDate.getDay() === 0) currentDate.setDate(currentDate.getDate() + 1); // pula domingo
        if (currentDate.getDay() === 6) currentDate.setDate(currentDate.getDate() + 2); // pula sábado
        currentDate.setHours(8, 0, 0, 0);
        minutesUsedToday = 0;
      }

      const endDate = new Date(currentDate);
      endDate.setMinutes(endDate.getMinutes() + durationMinutes);

      const schedule = await this.prisma.productionSchedule.create({
        data: {
          companyId,
          productionOrderId: op.id,
          workCenterId,
          startDate: new Date(currentDate),
          endDate,
          sequence,
          durationMinutes: Math.round(durationMinutes),
        },
      });

      schedules.push(schedule);
      minutesUsedToday += durationMinutes;
      currentDate = new Date(endDate);
      sequence++;
    }

    this.logger.log(`Schedule gerado: ${schedules.length} OPs no WorkCenter ${workCenterId}`);
    return { workCenterId, totalOrders: schedules.length, schedules };
  }

  async getSchedule(companyId: string, workCenterId?: string) {
    return this.prisma.productionSchedule.findMany({
      where: { companyId, ...(workCenterId ? { workCenterId } : {}) },
      include: { productionOrder: { include: { product: true } } },
      orderBy: [{ startDate: 'asc' }, { sequence: 'asc' }],
    });
  }

  async getGanttData(companyId: string) {
    const schedules = await this.prisma.productionSchedule.findMany({
      where: { companyId },
      include: { productionOrder: { include: { product: true } } },
      orderBy: { startDate: 'asc' },
    });

    return schedules.map(s => ({
      id: s.id,
      workCenterId: s.workCenterId,
      orderId: s.productionOrderId,
      product: (s as any).productionOrder?.product?.name ?? 'N/A',
      start: s.startDate,
      end: s.endDate,
      duration: s.durationMinutes,
      sequence: s.sequence,
      status: s.status,
    }));
  }
}
