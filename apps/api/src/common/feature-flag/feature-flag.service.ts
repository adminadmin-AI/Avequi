import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Chaves de feature flag conhecidas (evita string solta nos callers).
 * Valores são armazenados em SystemParameter por company (PR-2 do épico #527).
 */
export const FeatureFlag = {
  RENAVE_ENABLED: 'renave.enabled',
  /** Focus-A (#608): sincronização automática de NF-e recebidas via Focus. Default OFF por company. */
  FOCUS_NFE_RECEBIDAS_ENABLED: 'focus.nfe_recebidas.enabled',
} as const;

export type FeatureFlagKey = (typeof FeatureFlag)[keyof typeof FeatureFlag];

/**
 * Lê (e, para o conector Focus, grava) feature flags em SystemParameter,
 * isoladas por companyId.
 *
 * Semântica fail-closed: flag ausente, valor inválido ou qualquer coisa
 * diferente de "true" (case-insensitive, trimmed) → false. Uma flag que
 * protege integração externa (RENAVE/BIN) nunca deve ligar por engano.
 *
 * PR-2 (#527): sem caller de produção ainda — o módulo só é importado
 * pelo primeiro consumidor em PR futuro.
 */
@Injectable()
export class FeatureFlagService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(companyId: string, flag: FeatureFlagKey): Promise<boolean> {
    const param = await this.prisma.systemParameter.findUnique({
      where: { companyId_key: { companyId, key: flag } },
    });
    if (!param) return false; // default OFF quando o parâmetro não existe
    return param.value.trim().toLowerCase() === 'true';
  }

  /**
   * Liga/desliga uma flag por company. Valor canônico 'true'/'false' —
   * qualquer outra coisa continua sendo lida como OFF (fail-closed).
   */
  async setEnabled(companyId: string, flag: FeatureFlagKey, enabled: boolean): Promise<void> {
    const value = enabled ? 'true' : 'false';
    await this.prisma.systemParameter.upsert({
      where: { companyId_key: { companyId, key: flag } },
      update: { value },
      create: { companyId, key: flag, value },
    });
  }
}
