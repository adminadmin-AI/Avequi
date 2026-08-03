import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SessionRevokedReason } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { SessionService } from '../iam/session.service';
import { ENUM_ROLE_TO_SYSTEM_ROLE } from '../iam/roles.catalog';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SELECT_SAFE = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  companyId: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly sessionService: SessionService,
    private readonly entitlementService: EntitlementService,
  ) {}

  /**
   * OPS WP4 (#911): limite de usuários do plano (maxUsers, conta ativa na
   * árvore matriz+filiais). Tenant legado (sem plano) = ilimitado. O aviso
   * "80% do limite" fica com a UI (GET /entitlements/me + contagem); aqui é
   * só o bloqueio duro no teto.
   */
  private async assertUserLimit(companyId: string): Promise<void> {
    const limit = await this.entitlementService.limit(companyId, 'maxUsers');
    if (limit === null) return; // ilimitado
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, parentId: true },
    });
    const rootId = company?.parentId ?? companyId;
    const treeIds = [
      rootId,
      ...(
        await this.prisma.company.findMany({
          where: { parentId: rootId },
          select: { id: true },
        })
      ).map((c) => c.id),
    ];
    const activeUsers = await this.prisma.user.count({
      where: { companyId: { in: treeIds }, isActive: true },
    });
    if (activeUsers >= limit) {
      throw new ForbiddenException(
        `Sua empresa atingiu o limite de ${limit} usuários do plano contratado. ` +
          'Desative um usuário ou fale com a Avecchi para ampliar o plano.',
      );
    }
  }

  async create(dto: CreateUserDto, companyId: string, actorId: string) {
    await this.assertUserLimit(companyId);
    // #345: senha definida pelo admin também passa pela política de
    // complexidade (inclusive não conter o nome/e-mail do NOVO usuário).
    this.passwordPolicy.validateComplexity(dto.password, {
      email: dto.email,
      name: dto.name,
    });

    // #738: resolve o perfil RBAC v2 ANTES de criar nada. O usuário nasce com
    // o vínculo v2 do perfil-espelho do enum (mesmo mapeamento do seed), senão
    // o PermissionGuard (fail-closed) negaria toda rota até um seed rodar.
    // Ao contrário do seed (tolerante, pula sem mapear), na criação de um
    // usuário NOVO um mapeamento ausente FALHA a operação inteira — não
    // criamos usuário sem perfil v2 (seria reproduzir o bug da #738).
    const roleId = await this.resolveSystemRoleIdForEnum(dto.role);

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const { password: _pw, ...rest } = dto;
    // Nested write: o Prisma envolve user + assignment numa ÚNICA transação
    // implícita (batch, não interativa) — atômico e compatível com o pooler
    // transacional do Supabase; o userId do vínculo é preenchido pela relação.
    const user = await this.prisma.user.create({
      // companyId SEMPRE vem do JWT (nunca do body — #450). #345:
      // passwordChangedAt marca a criação; mustChangePassword=true por PADRÃO
      // (senha definida por admin é temporária — decisão Rafael #468), salvo se
      // o admin passar explicitamente `false`.
      data: {
        ...rest,
        companyId,
        passwordHash,
        passwordChangedAt: new Date(),
        mustChangePassword: dto.mustChangePassword ?? true,
        // #738: vínculo v2 escopado à empresa do usuário (o perfil system é
        // global/companyId null, mas a atribuição vale na empresa dele — mesma
        // regra do seed). grantedBy = admin autenticado (do JWT, nunca do body).
        roleAssignments: {
          create: { roleId, companyId, grantedBy: actorId },
        },
      },
      select: SELECT_SAFE,
    });

    // #345: hash inicial entra no histórico — o bloqueio de reuso das
    // últimas 5 senhas vale desde a primeira troca (best-effort).
    await this.passwordPolicy.recordPasswordChange(user.id, null, passwordHash);

    return user;
  }

  /**
   * #738: mapeia o papel legado (enum) → perfil system RBAC v2 e devolve o id.
   * Falha explícita (sem criar usuário) se o enum não tem espelho no catálogo
   * ou se o perfil system não existe no banco — o oposto do comportamento
   * tolerante do seed, que pode pular usuários pré-existentes sem mapa.
   */
  private async resolveSystemRoleIdForEnum(enumRole: string): Promise<string> {
    const systemRoleCode = ENUM_ROLE_TO_SYSTEM_ROLE[enumRole];
    if (!systemRoleCode) {
      throw new BadRequestException(
        `Papel '${enumRole}' não tem perfil RBAC v2 correspondente no catálogo. ` +
          'Cadastre o mapeamento antes de criar usuários com este papel.',
      );
    }
    // Perfil system = global (companyId null) — mesma âncora usada pelo seed.
    const role = await this.prisma.role.findFirst({
      where: { code: systemRoleCode, companyId: null },
      select: { id: true },
    });
    if (!role) {
      throw new BadRequestException(
        `Perfil system '${systemRoleCode}' não encontrado. Rode o seed de perfis IAM antes de criar usuários.`,
      );
    }
    return role.id;
  }

  async findAll(requestingUser: { role: string; companyId: string }) {
    const where =
      requestingUser.role === 'SUPER_ADMIN'
        ? {}
        : { companyId: requestingUser.companyId };

    return this.prisma.user.findMany({
      where,
      select: SELECT_SAFE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId },
      select: SELECT_SAFE,
    });
    if (!user) throw new NotFoundException(`Usuário ${id} não encontrado`);
    return user;
  }

  async update(id: string, dto: UpdateUserDto, companyId: string, actorId: string) {
    const existing = await this.findOne(id, companyId);

    // ── Inativação (isActive true→false): proteções obrigatórias ────────────
    // Todas rodam ANTES de qualquer persistência: rejeição não deixa update
    // parcial (nem dos demais campos enviados na mesma requisição).
    const deactivating = dto.isActive === false && existing.isActive === true;
    if (deactivating) {
      // 1) Autoinativação: o botão desabilitado no front é só UX — a regra
      // real vive aqui. O actorId vem do JWT (@CurrentUser), nunca do body.
      if (actorId === id) {
        throw new ForbiddenException('Você não pode inativar a própria conta.');
      }
      // 2) Último administrador global efetivo do sistema.
      await this.assertNotLastActiveGlobalAdmin(id);
    }
    // Defesa em profundidade: descarta password (hash separado) e qualquer
    // companyId injetado no payload — usuário nunca muda de empresa via update (#450)
    const { password, companyId: _ignored, ...rest } = dto as any;
    const data: any = { ...rest };
    let previousHash: string | null = null;
    if (password) {
      // #345: reset de senha por admin também obedece à política —
      // complexidade + bloqueio de reuso das últimas 5 senhas do usuário.
      this.passwordPolicy.validateComplexity(password, {
        email: dto.email ?? existing.email,
        name: dto.name ?? existing.name,
      });
      await this.passwordPolicy.assertNotReused(id, password);

      // Hash atual ANTES do update — na primeira troca ele entra no histórico.
      const current = await this.prisma.user.findUnique({
        where: { id },
        select: { passwordHash: true },
      });
      previousHash = current?.passwordHash ?? null;

      data.passwordHash = await bcrypt.hash(password, 10);
      data.passwordChangedAt = new Date();
      // #468 (decisão Rafael): reset de senha por admin força a troca no
      // próximo login por PADRÃO — salvo se o admin passar mustChangePassword
      // explicitamente (ex.: false para não forçar).
      if (data.mustChangePassword === undefined) {
        data.mustChangePassword = true;
      }
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: SELECT_SAFE,
    });

    if (deactivating) {
      // Pós-checagem anti-corrida: duas inativações simultâneas de admins
      // globais podem AMBAS passar na pré-checagem (read committed). Se após
      // persistir não restou NENHUM admin global ativo, tenta COMPENSAR
      // (reativa o usuário) e rejeita a requisição. Isso MITIGA a corrida e
      // restaura o estado nas colisões cobertas pelos testes — mas NÃO é uma
      // garantia absoluta: sem serialização/lock/transação atômica (o pooler
      // do Supabase em modo transação não suporta transação interativa com
      // segurança), permanece uma janela residual excepcional se processo,
      // banco ou conexão falharem entre a persistência e a compensação. O
      // endurecimento definitivo (lock/serialização compatível com a infra)
      // fica como débito técnico separado.
      if (await this.isEffectiveGlobalAdmin(id)) {
        const remaining = await this.countActiveGlobalAdmins(id);
        if (remaining === 0) {
          try {
            await this.prisma.user.update({ where: { id }, data: { isActive: true } });
          } catch (err) {
            // Compensação falhou: o usuário ficou inativo SEM nenhum admin
            // global ativo restante — estado inconsistente que exige ação
            // manual. Nunca silencioso: log crítico estruturado (só IDs
            // técnicos, sem dado sensível) e a requisição retorna erro.
            this.logger.error(
              JSON.stringify({
                event: 'user_deactivate_last_admin_compensation_failed',
                severity: 'critical',
                userId: id,
                actorId,
                message: (err as Error).message,
              }),
            );
            throw new ConflictException(
              'Falha ao proteger o último administrador global: o usuário pode ter ficado ' +
                'inativo. Reative-o imediatamente e contate o suporte.',
            );
          }
          throw new ConflictException(
            'Não é possível inativar o último administrador global ativo do sistema.',
          );
        }
      }

      // 3) Sessões: inativado não fica logado. Revoga TODAS (reason SECURITY
      // → denylist mata os access tokens imediatamente, não só o refresh).
      // Falha aqui NÃO desfaz a inativação nem fica silenciosa: o refresh já
      // é barrado pelo check de isActive (#221), então o resíduo máximo são
      // access tokens até expirarem (15 min) — logado como erro estruturado.
      try {
        await this.sessionService.revokeAllSessions(id, SessionRevokedReason.SECURITY);
      } catch (err) {
        this.logger.error(
          JSON.stringify({
            event: 'user_deactivate_session_revoke_failed',
            userId: id,
            actorId,
            message: (err as Error).message,
          }),
        );
      }
    }

    if (password) {
      // #345: registra a troca no histórico (best-effort).
      await this.passwordPolicy.recordPasswordChange(id, previousHash, data.passwordHash);

      // Reset por admin corta o acesso VIGENTE do alvo: revoga TODAS as
      // sessões dele (reason SECURITY → denylist mata os access tokens
      // imediatamente, não só o refresh). Sem isso, uma sessão viva
      // sobreviveria à troca renovando o refresh indefinidamente — o reset
      // feito para cortar o acesso de alguém não cortaria. O alvo é `id`
      // (usuário redefinido), nunca `actorId` (admin que redefiniu).
      // Mesma política de falha da inativação acima (#744): a troca NÃO é
      // desfeita nem a falha fica silenciosa; o refresh barrado por
      // mustChangePassword limita o resíduo à vida do access token (15 min).
      try {
        await this.sessionService.revokeAllSessions(id, SessionRevokedReason.SECURITY);
      } catch (err) {
        this.logger.error(
          JSON.stringify({
            event: 'user_password_reset_session_revoke_failed',
            userId: id,
            actorId,
            message: (err as Error).message,
          }),
        );
      }
    }

    return updated;
  }

  // ── Administrador global efetivo (IAM v2) ──────────────────────────────────
  // "Efetivo" = vínculo NÃO expirado ao perfil system ADMIN_GLOBAL (RBAC v2).
  // O enum legado SUPER_ADMIN sem vínculo v2 NÃO conta: o PermissionGuard é
  // fail-closed sem vínculo, então esse usuário não conseguiria administrar
  // usuários/permissões de qualquer forma (não serve como admin de resgate).
  // Contagem é GLOBAL (todas as empresas): o perfil é de plataforma.

  private assignmentActiveWhere(userId?: string) {
    return {
      ...(userId ? { userId } : {}),
      role: { code: 'ADMIN_GLOBAL' },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };
  }

  private async isEffectiveGlobalAdmin(userId: string): Promise<boolean> {
    const count = await this.prisma.userRoleAssignment.count({
      where: this.assignmentActiveWhere(userId),
    });
    return count > 0;
  }

  /** Admins globais ATIVOS além do usuário excluído da contagem. */
  private async countActiveGlobalAdmins(excludeUserId: string): Promise<number> {
    return this.prisma.user.count({
      where: {
        id: { not: excludeUserId },
        isActive: true,
        roleAssignments: { some: this.assignmentActiveWhere() },
      },
    });
  }

  private async assertNotLastActiveGlobalAdmin(targetUserId: string): Promise<void> {
    if (!(await this.isEffectiveGlobalAdmin(targetUserId))) return; // alvo não é admin global
    const others = await this.countActiveGlobalAdmins(targetUserId);
    if (others === 0) {
      throw new ConflictException(
        'Não é possível inativar o último administrador global ativo do sistema.',
      );
    }
  }
}
