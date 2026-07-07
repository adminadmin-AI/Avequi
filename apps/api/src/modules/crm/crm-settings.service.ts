import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Parâmetros de CRM guardados em SystemParameter (por company) */
const PARAM_KEYS = {
  slaFirstResponseMin: 'CRM_SLA_FIRST_RESPONSE_MIN',
  // Escalonamento de SLA (#569)
  slaEscalationEnabled: 'CRM_SLA_ESCALATION_ENABLED',
  slaEscalationFactor: 'CRM_SLA_ESCALATION_FACTOR',
  coolingHours: 'CRM_COOLING_HOURS',
  reopenLostDays: 'CRM_REOPEN_LOST_DAYS',
  autoFollowupEnabled: 'CRM_AUTO_FOLLOWUP_ENABLED',
  autoFollowupStageId: 'CRM_AUTO_FOLLOWUP_STAGE_ID',
  autoFollowupHours: 'CRM_AUTO_FOLLOWUP_HOURS',
  autoFollowupTemplate: 'CRM_AUTO_FOLLOWUP_TEMPLATE',
  leadRetentionDays: 'CRM_LEAD_RETENTION_DAYS',
  // F4 SDR IA (#521/#523/#524)
  sdrEnabled: 'CRM_SDR_ENABLED',
  sdrModel: 'CRM_SDR_MODEL',
  sdrMaxTurns: 'CRM_SDR_MAX_TURNS',
  sdrSchedule: 'CRM_SDR_SCHEDULE',
} as const;

const DEFAULTS = {
  slaFirstResponseMin: 15,
  slaEscalationEnabled: false, // #569 — default off: ligar por loja sem deploy
  slaEscalationFactor: 2, // nível 2 (realoca) em SLA x2
  coolingHours: 24,
  reopenLostDays: 90,
  autoFollowupEnabled: false,
  autoFollowupStageId: null as string | null,
  autoFollowupHours: 48,
  autoFollowupTemplate: null as string | null,
  leadRetentionDays: 0, // 0 = expurgo LGPD desligado (#558)
  sdrEnabled: false, // kill switch: SDR IA desligado por default (#523)
  sdrModel: 'claude-opus-4-8', // decisão Claudio #521; permite A/B sonnet/haiku
  sdrMaxTurns: 12, // handoff garantido após N trocas da IA (#523)
  sdrSchedule: '24_7' as '24_7' | 'OFF_HOURS',
};

export interface CrmSettings {
  slaFirstResponseMin: number;
  /** Escalonamento de SLA (#569): avisa no x1, realoca no x{factor} */
  slaEscalationEnabled: boolean;
  slaEscalationFactor: number;
  coolingHours: number;
  reopenLostDays: number;
  autoFollowupEnabled: boolean;
  autoFollowupStageId: string | null;
  autoFollowupHours: number;
  autoFollowupTemplate: string | null;
  /** LGPD (#558): anonimizar leads perdidos após N dias (0 = desligado) */
  leadRetentionDays: number;
  /** F4 SDR IA: kill switch por loja (#523) */
  sdrEnabled: boolean;
  sdrModel: string;
  sdrMaxTurns: number;
  sdrSchedule: '24_7' | 'OFF_HOURS';
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
      slaEscalationEnabled: byKey.get(PARAM_KEYS.slaEscalationEnabled) === 'true',
      slaEscalationFactor: num(PARAM_KEYS.slaEscalationFactor, DEFAULTS.slaEscalationFactor),
      coolingHours: num(PARAM_KEYS.coolingHours, DEFAULTS.coolingHours),
      reopenLostDays: num(PARAM_KEYS.reopenLostDays, DEFAULTS.reopenLostDays),
      autoFollowupEnabled: byKey.get(PARAM_KEYS.autoFollowupEnabled) === 'true',
      autoFollowupStageId: byKey.get(PARAM_KEYS.autoFollowupStageId) ?? DEFAULTS.autoFollowupStageId,
      autoFollowupHours: num(PARAM_KEYS.autoFollowupHours, DEFAULTS.autoFollowupHours),
      autoFollowupTemplate: byKey.get(PARAM_KEYS.autoFollowupTemplate) ?? DEFAULTS.autoFollowupTemplate,
      leadRetentionDays: num(PARAM_KEYS.leadRetentionDays, DEFAULTS.leadRetentionDays),
      sdrEnabled: byKey.get(PARAM_KEYS.sdrEnabled) === 'true',
      sdrModel: byKey.get(PARAM_KEYS.sdrModel) || DEFAULTS.sdrModel,
      sdrMaxTurns: num(PARAM_KEYS.sdrMaxTurns, DEFAULTS.sdrMaxTurns),
      sdrSchedule:
        byKey.get(PARAM_KEYS.sdrSchedule) === 'OFF_HOURS' ? 'OFF_HOURS' : DEFAULTS.sdrSchedule,
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
    if (input.slaEscalationEnabled != null)
      setParam(PARAM_KEYS.slaEscalationEnabled, String(input.slaEscalationEnabled));
    if (input.slaEscalationFactor != null) {
      if (input.slaEscalationFactor < 2) {
        throw new BadRequestException('Multiplicador do escalonamento deve ser no mínimo 2');
      }
      setParam(PARAM_KEYS.slaEscalationFactor, String(input.slaEscalationFactor));
    }
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
    if (input.leadRetentionDays != null) {
      if (input.leadRetentionDays < 0) {
        throw new BadRequestException('Retenção não pode ser negativa (0 desliga o expurgo)');
      }
      setParam(PARAM_KEYS.leadRetentionDays, String(input.leadRetentionDays));
    }
    if (input.sdrEnabled != null) setParam(PARAM_KEYS.sdrEnabled, String(input.sdrEnabled));
    if (input.sdrModel != null) setParam(PARAM_KEYS.sdrModel, input.sdrModel);
    if (input.sdrMaxTurns != null) {
      if (input.sdrMaxTurns < 2) throw new BadRequestException('Mínimo de 2 trocas da IA');
      setParam(PARAM_KEYS.sdrMaxTurns, String(input.sdrMaxTurns));
    }
    if (input.sdrSchedule != null) {
      if (!['24_7', 'OFF_HOURS'].includes(input.sdrSchedule)) {
        throw new BadRequestException('Horário do SDR: 24_7 ou OFF_HOURS');
      }
      setParam(PARAM_KEYS.sdrSchedule, input.sdrSchedule);
    }

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
