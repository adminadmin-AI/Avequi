import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Parâmetros de CRM guardados em SystemParameter (por company) */
const PARAM_KEYS = {
  slaFirstResponseMin: 'CRM_SLA_FIRST_RESPONSE_MIN',
  coolingHours: 'CRM_COOLING_HOURS',
  reopenLostDays: 'CRM_REOPEN_LOST_DAYS',
  autoFollowupEnabled: 'CRM_AUTO_FOLLOWUP_ENABLED',
  autoFollowupStageId: 'CRM_AUTO_FOLLOWUP_STAGE_ID',
  autoFollowupHours: 'CRM_AUTO_FOLLOWUP_HOURS',
  autoFollowupTemplate: 'CRM_AUTO_FOLLOWUP_TEMPLATE',
} as const;

const DEFAULTS = {
  slaFirstResponseMin: 15,
  coolingHours: 24,
  reopenLostDays: 90,
  autoFollowupEnabled: false,
  autoFollowupStageId: null as string | null,
  autoFollowupHours: 48,
  autoFollowupTemplate: null as string | null,
};

export interface CrmSettings {
  slaFirstResponseMin: number;
  coolingHours: number;
  reopenLostDays: number;
  autoFollowupEnabled: boolean;
  autoFollowupStageId: string | null;
  autoFollowupHours: number;
  autoFollowupTemplate: string | null;
  waPhoneNumberId: string | null;
}

/**
 * F3.5-C1 (#551) — configuração do CRM por loja. Numéricos/flags vivem em
 * SystemParameter; o número de WhatsApp na coluna Company.waPhoneNumberId.
 */
@Injectable()
export class CrmSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(companyId: string): Promise<CrmSettings> {
    const [params, company] = await Promise.all([
      this.prisma.systemParameter.findMany({
        where: { companyId, key: { in: Object.values(PARAM_KEYS) } },
      }),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { waPhoneNumberId: true },
      }),
    ]);
    const byKey = new Map(params.map((p) => [p.key, p.value]));
    const num = (key: string, def: number) => {
      const v = byKey.get(key);
      const n = v != null ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) ? n : def;
    };
    return {
      slaFirstResponseMin: num(PARAM_KEYS.slaFirstResponseMin, DEFAULTS.slaFirstResponseMin),
      coolingHours: num(PARAM_KEYS.coolingHours, DEFAULTS.coolingHours),
      reopenLostDays: num(PARAM_KEYS.reopenLostDays, DEFAULTS.reopenLostDays),
      autoFollowupEnabled: byKey.get(PARAM_KEYS.autoFollowupEnabled) === 'true',
      autoFollowupStageId: byKey.get(PARAM_KEYS.autoFollowupStageId) ?? DEFAULTS.autoFollowupStageId,
      autoFollowupHours: num(PARAM_KEYS.autoFollowupHours, DEFAULTS.autoFollowupHours),
      autoFollowupTemplate: byKey.get(PARAM_KEYS.autoFollowupTemplate) ?? DEFAULTS.autoFollowupTemplate,
      waPhoneNumberId: company?.waPhoneNumberId ?? null,
    };
  }

  async update(companyId: string, input: Partial<CrmSettings>): Promise<CrmSettings> {
    // validação de faixas (evita SLA 0 ou negativo)
    if (input.slaFirstResponseMin != null && input.slaFirstResponseMin <= 0) {
      throw new BadRequestException('SLA deve ser maior que zero');
    }
    if (input.coolingHours != null && input.coolingHours <= 0) {
      throw new BadRequestException('Horas de esfriamento deve ser maior que zero');
    }

    const writes: Array<Promise<unknown>> = [];
    const setParam = (key: string, value: string | null) => {
      if (value == null) return;
      writes.push(this.setParam(companyId, key, value));
    };

    if (input.slaFirstResponseMin != null)
      setParam(PARAM_KEYS.slaFirstResponseMin, String(input.slaFirstResponseMin));
    if (input.coolingHours != null) setParam(PARAM_KEYS.coolingHours, String(input.coolingHours));
    if (input.reopenLostDays != null)
      setParam(PARAM_KEYS.reopenLostDays, String(input.reopenLostDays));
    if (input.autoFollowupEnabled != null)
      setParam(PARAM_KEYS.autoFollowupEnabled, String(input.autoFollowupEnabled));
    if (input.autoFollowupStageId !== undefined)
      setParam(PARAM_KEYS.autoFollowupStageId, input.autoFollowupStageId ?? '');
    if (input.autoFollowupHours != null)
      setParam(PARAM_KEYS.autoFollowupHours, String(input.autoFollowupHours));
    if (input.autoFollowupTemplate !== undefined)
      setParam(PARAM_KEYS.autoFollowupTemplate, input.autoFollowupTemplate ?? '');

    if (input.waPhoneNumberId !== undefined) {
      writes.push(
        this.prisma.company.update({
          where: { id: companyId },
          data: { waPhoneNumberId: input.waPhoneNumberId || null },
        }),
      );
    }

    await Promise.all(writes);
    return this.get(companyId);
  }

  /** Vendedores da loja com disponibilidade no rodízio (tela de config) */
  async sellers(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId, isActive: true, role: { in: ['COMMERCIAL', 'STORE', 'MANAGER'] } },
      select: { id: true, name: true, role: true, crmAvailable: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Liga/desliga vendedor no rodízio (férias/folga) */
  async setSellerAvailability(companyId: string, userId: string, available: boolean) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException('Vendedor não encontrado nesta loja');
    return this.prisma.user.update({
      where: { id: userId },
      data: { crmAvailable: available },
      select: { id: true, name: true, crmAvailable: true },
    });
  }

  private async setParam(companyId: string, key: string, value: string): Promise<void> {
    const existing = await this.prisma.systemParameter.findFirst({ where: { companyId, key } });
    if (existing) {
      await this.prisma.systemParameter.update({ where: { id: existing.id }, data: { value } });
    } else {
      await this.prisma.systemParameter.create({ data: { companyId, key, value } });
    }
  }
}
