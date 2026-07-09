import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvestmentProjectDto } from './dto/create-investment-project.dto';
import { UpdateInvestmentProjectDto } from './dto/update-investment-project.dto';
import { UpsertCashflowDto } from './dto/upsert-cashflow.dto';
import { irr, npv, paybackDiscounted, paybackSimple } from './investment.math';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface InvestmentAnalysis {
  discountRatePct: number;
  npv: number;
  irrPct: number | null;
  paybackSimple: number | null; // períodos
  paybackDiscounted: number | null;
  viable: boolean; // VPL ≥ 0
  series: Array<{
    period: number;
    flow: number;
    cumulative: number;
    discountedFlow: number;
    discountedCumulative: number;
  }>;
}

@Injectable()
export class InvestmentService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD projeto ────────────────────────────────────────────────────────────

  createProject(companyId: string, dto: CreateInvestmentProjectDto) {
    return this.prisma.investmentProject.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description,
        discountRatePct: dto.discountRatePct ?? 0,
      },
    });
  }

  listProjects(companyId: string) {
    return this.prisma.investmentProject.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProject(companyId: string, id: string) {
    const project = await this.prisma.investmentProject.findFirst({
      where: { id, companyId },
      include: { cashflows: { orderBy: { period: 'asc' } } },
    });
    if (!project) throw new NotFoundException(`Projeto de investimento ${id} não encontrado`);
    return { ...project, analysis: this.analyzeProject(project) };
  }

  async updateProject(companyId: string, id: string, dto: UpdateInvestmentProjectDto) {
    await this.getProjectOrThrow(companyId, id);
    return this.prisma.investmentProject.update({ where: { id }, data: dto });
  }

  async deleteProject(companyId: string, id: string) {
    await this.getProjectOrThrow(companyId, id);
    return this.prisma.investmentProject.delete({ where: { id } });
  }

  // ─── Fluxos de caixa ─────────────────────────────────────────────────────────

  async upsertCashflow(companyId: string, projectId: string, dto: UpsertCashflowDto) {
    await this.getProjectOrThrow(companyId, projectId);
    const existing = await this.prisma.investmentCashflow.findFirst({
      where: { projectId, period: dto.period, companyId },
    });
    if (existing) {
      return this.prisma.investmentCashflow.update({
        where: { id: existing.id },
        data: { amount: dto.amount, label: dto.label },
      });
    }
    return this.prisma.investmentCashflow.create({
      data: { companyId, projectId, period: dto.period, amount: dto.amount, label: dto.label },
    });
  }

  async removeCashflow(companyId: string, projectId: string, cashflowId: string) {
    const cf = await this.prisma.investmentCashflow.findFirst({
      where: { id: cashflowId, projectId, companyId },
    });
    if (!cf) throw new NotFoundException(`Fluxo ${cashflowId} não encontrado`);
    return this.prisma.investmentCashflow.delete({ where: { id: cashflowId } });
  }

  // ─── Aprovação (alçada DIRECTOR) ─────────────────────────────────────────────

  async decide(companyId: string, id: string, userId: string | undefined, approved: boolean) {
    const project = await this.getProjectOrThrow(companyId, id);
    if (project.status !== 'DRAFT') {
      throw new BadRequestException(`Projeto já está ${project.status} — só é possível decidir em DRAFT`);
    }
    return this.prisma.investmentProject.update({
      where: { id },
      data: {
        status: (approved ? 'APPROVED' : 'REJECTED') as any,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });
  }

  // ─── Comparativo lado a lado ─────────────────────────────────────────────────

  async compare(companyId: string, ids: string[]) {
    const projects = await this.prisma.investmentProject.findMany({
      where: { id: { in: ids }, companyId },
      include: { cashflows: { orderBy: { period: 'asc' } } },
    });
    return projects.map((p) => {
      const a = this.analyzeProject(p);
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        npv: a.npv,
        irrPct: a.irrPct,
        paybackSimple: a.paybackSimple,
        paybackDiscounted: a.paybackDiscounted,
        viable: a.viable,
      };
    });
  }

  // ─── Núcleo do cálculo ───────────────────────────────────────────────────────

  private analyzeProject(project: {
    discountRatePct: unknown;
    cashflows: Array<{ period: number; amount: unknown }>;
  }): InvestmentAnalysis {
    const ratePct = Number(project.discountRatePct);
    const rate = ratePct / 100;

    // Série densa indexada por período (lacunas = 0)
    const maxPeriod = project.cashflows.reduce((m, c) => Math.max(m, c.period), 0);
    const flows = new Array(maxPeriod + 1).fill(0);
    for (const c of project.cashflows) flows[c.period] = Number(c.amount);

    const value = npv(rate, flows);
    const irrValue = irr(flows);
    const pbSimple = paybackSimple(flows);
    const pbDisc = paybackDiscounted(rate, flows);

    let cum = 0;
    let dcum = 0;
    const series = flows.map((flow, period) => {
      const discountedFlow = flow / Math.pow(1 + rate, period);
      cum += flow;
      dcum += discountedFlow;
      return {
        period,
        flow: round2(flow),
        cumulative: round2(cum),
        discountedFlow: round2(discountedFlow),
        discountedCumulative: round2(dcum),
      };
    });

    return {
      discountRatePct: round2(ratePct),
      npv: round2(value),
      irrPct: irrValue != null ? round2(irrValue * 100) : null,
      paybackSimple: pbSimple,
      paybackDiscounted: pbDisc,
      viable: value >= 0,
      series,
    };
  }

  private async getProjectOrThrow(companyId: string, id: string) {
    const project = await this.prisma.investmentProject.findFirst({ where: { id, companyId } });
    if (!project) throw new NotFoundException(`Projeto de investimento ${id} não encontrado`);
    return project;
  }
}
