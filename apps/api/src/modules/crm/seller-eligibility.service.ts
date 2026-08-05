import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../iam/permission.service';

/**
 * #1002-C3 — fonte ÚNICA de quem pode receber lead.
 *
 * Antes existiam três listas de enum, em três arquivos, e elas **divergiam**:
 * o rodízio e o agente SDR aceitavam COMMERCIAL e STORE; a tela de
 * configuração aceitava COMMERCIAL, STORE e MANAGER. Resultado prático: o
 * gestor via o gerente na tela, ligava o toggle de disponibilidade dele — e o
 * gerente nunca recebia lead nenhum, porque o rodízio não o considerava.
 *
 * ── Duas perguntas diferentes ──────────────────────────────────────────────
 * "Pode ser vendedor?" e "Está disponível agora?" não são a mesma coisa, e
 * misturá-las foi o que criou a divergência:
 *
 *   - **Classe** → permissão `crm.leads.assignable`. Muda quando alguém troca
 *     de função. É autorização.
 *   - **Disponibilidade** → `User.crmAvailable`. Muda por férias, folga,
 *     licença. É operação do dia a dia do gestor.
 *
 * Tirar alguém do rodízio por uma semana não deve exigir mexer em permissão:
 * viraria agenda escrita em autorização, e sujaria a trilha de acesso.
 *
 * ── Onde cada filtro entra ─────────────────────────────────────────────────
 * A tela de configuração lista TODO MUNDO da classe, inclusive indisponíveis
 * — é lá que a disponibilidade é editada, esconder quem está de férias
 * impediria de trazer a pessoa de volta. Os caminhos que ATRIBUEM lead exigem
 * também `crmAvailable` e conta destravada.
 */

/** Permissão que marca a CLASSE de quem pode receber lead (#1002-C3). */
export const LEAD_ASSIGNABLE_PERMISSION = 'crm.leads.assignable';

/** Motivo estruturado para o log de captação sem destino (#1002-C3). */
export const NO_ELIGIBLE_SELLER = 'NO_ELIGIBLE_SELLER';

export interface CandidatoElegivel {
  id: string;
  name: string;
  crmAvailable: boolean;
}

@Injectable()
export class SellerEligibilityService {
  private readonly logger = new Logger(SellerEligibilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Candidatos para ATRIBUIÇÃO de lead — rodízio e SDR.
   *
   * Exige, simultaneamente: a permissão, usuário ativo, conta destravada,
   * disponível no rodízio e a mesma empresa. O recorte é a `Company` do lead:
   * uma filial é uma Company própria, e lead de filial não vai para vendedor
   * da matriz. Por isso o `TenantScopeService` NÃO é usado aqui — ele
   * ampliaria para o grupo, que é o oposto do que se quer.
   */
  async candidatosParaAtribuicao(
    companyId: string,
    excludeUserId?: string,
  ): Promise<Array<{ id: string }>> {
    const elegiveis = await this.permissions.usersWithPermission(
      companyId,
      LEAD_ASSIGNABLE_PERMISSION,
    );
    if (elegiveis.length === 0) return [];

    return this.prisma.user.findMany({
      where: {
        id: { in: elegiveis, ...(excludeUserId ? { not: excludeUserId } : {}) },
        companyId,
        isActive: true,
        crmAvailable: true,
        // #1002-C3: conta travada por lockout não recebe lead — a pessoa não
        // consegue entrar para atender, e o lead ficaria parado sem ninguém
        // perceber. `lockedUntil` no passado ou nulo não bloqueia.
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Candidatos para a TELA DE CONFIGURAÇÃO do rodízio.
   *
   * Mesma classe da atribuição — é a garantia de que a tela não promete o que
   * o rodízio não cumpre —, mas SEM o filtro de disponibilidade: é justamente
   * ali que `crmAvailable` é ligado e desligado.
   */
  async candidatosParaConfiguracao(companyId: string): Promise<CandidatoElegivel[]> {
    const elegiveis = await this.permissions.usersWithPermission(
      companyId,
      LEAD_ASSIGNABLE_PERMISSION,
    );
    if (elegiveis.length === 0) return [];

    return this.prisma.user.findMany({
      where: { id: { in: elegiveis }, companyId, isActive: true },
      select: { id: true, name: true, crmAvailable: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Log estruturado de captação sem destino.
   *
   * Sem dado de cliente: só empresa, origem e o motivo nomeado, para dar para
   * medir isso depois sem abrir o corpo do lead.
   */
  registrarSemElegivel(companyId: string, origem: string, avaliados?: number): void {
    this.logger.warn(
      JSON.stringify({
        event: 'crm_lead_unassigned',
        reason: NO_ELIGIBLE_SELLER,
        companyId,
        origem,
        ...(avaliados !== undefined ? { avaliados } : {}),
      }),
    );
  }
}
