import { Injectable } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * TenantStatusService — OPS WP1 (#908), fundação do control plane.
 *
 * O status de TENANT vive na empresa RAIZ (Company.parentId null); as filiais
 * (rows com parentId preenchido) herdam o status da raiz e têm o campo próprio
 * ignorado. A árvore tem 2 níveis por construção (MATRIZ → FILIAL), então a
 * resolução é 1 hop, sem recursão.
 *
 * Consumidores:
 * - AuthService (login e refresh): tenant SUSPENDED/CHURNED não autentica —
 *   o usuário vê orientação de regularização, não um 401 genérico.
 * - OpsService (WP1) e, nos próximos WPs, metering/billing (SANDBOX fora).
 */

/** Raiz do tenant com os campos de lifecycle relevantes para enforcement. */
export interface TenantRoot {
  id: string;
  name: string;
  tenantStatus: TenantStatus;
  suspendReason: string | null;
  isSandbox: boolean;
}

/** Bloqueio de autenticação derivado do status do tenant. */
export interface TenantLoginBlock {
  status: Extract<TenantStatus, 'SUSPENDED' | 'CHURNED'>;
  message: string;
}

const TENANT_ROOT_SELECT = {
  id: true,
  name: true,
  tenantStatus: true,
  suspendReason: true,
  isSandbox: true,
} as const;

@Injectable()
export class TenantStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a empresa raiz do tenant a partir de qualquer companyId
   * (matriz ou filial). Lança se a empresa não existir — companyId aqui vem
   * de registro interno (JWT/linha de User), nunca de input de cliente.
   */
  async getTenantRoot(companyId: string): Promise<TenantRoot> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        ...TENANT_ROOT_SELECT,
        parent: { select: TENANT_ROOT_SELECT },
      },
    });
    const { parent, ...self } = company;
    return parent ?? self;
  }

  /**
   * Bloqueio de login/refresh pelo status do tenant. Retorna null quando o
   * acesso está liberado (ACTIVE, TRIAL e SANDBOX autenticam normalmente).
   * Quem chama decide o efeito (LoginAttempt + 403) — este serviço só decide.
   */
  async getLoginBlock(companyId: string): Promise<TenantLoginBlock | null> {
    const root = await this.getTenantRoot(companyId);

    if (root.tenantStatus === TenantStatus.SUSPENDED) {
      return {
        status: TenantStatus.SUSPENDED,
        message:
          'O acesso da sua empresa está temporariamente suspenso. ' +
          'Procure o responsável pela conta para regularização junto à Avecchi.',
      };
    }

    if (root.tenantStatus === TenantStatus.CHURNED) {
      return {
        status: TenantStatus.CHURNED,
        message:
          'A conta da sua empresa foi encerrada. ' +
          'Se acredita que isso é um engano, contate o suporte da Avecchi.',
      };
    }

    return null;
  }
}
