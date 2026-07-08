import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Chaves de feature flag conhecidas (evita string solta nos callers).
 * Valores são armazenados em SystemParameter por company (PR-2 do épico #527).
 */
export const FeatureFlag = {
  RENAVE_ENABLED: 'renave.enabled',
} as const;

export type FeatureFlagKey = (typeof FeatureFlag)[keyof typeof FeatureFlag];

/**
 * Lê feature flags de SystemParameter, isoladas por companyId.
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
}
