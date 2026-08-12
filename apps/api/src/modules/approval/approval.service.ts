import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../iam/permission.service';
import { CreateApprovalMatrixDto, UpdateApprovalMatrixDto } from './dto/approval-matrix.dto';

/**
 * Aprovações por alçada (#188/#227) — matriz de níveis por documento.
 *
 * ── #1005 (IAM C6): o eixo da matriz saiu do enum ─────────────────────────
 * `ApprovalMatrix.approverRoles` passou a guardar CODES de perfil v2
 * (Role.code, ex.: GERENTE_GERAL) — não mais valores do enum `UserRole`
 * congelado. Quem opera é comparado pelos seus perfis v2 VIGENTES
 * (PermissionService.getUserPermissions → roles diretos, com cache), então a
 * alçada acompanha a gestão de acessos de verdade: trocou o perfil do
 * usuário, trocou o que ele aprova.
 *
 * Sem conversão de dados: `gdr_approval_matrices` tinha ZERO linhas em
 * produção quando a semântica virou (contagem read-only de 11/08/2026).
 *
 * ⚠️ Como no #947/#1004, a checagem NÃO honra o fallback legado do #946:
 * usuário sem RBAC v2 não casa com nenhum code — não aprova nível de matriz.
 */
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * SoD (#160/#350): trava de segregação de funções nas aprovações.
   * DESLIGADA por padrão (SOD_ENFORCE=false) — regra de negócio vigente da
   * empresa permite que a mesma pessoa crie e aprove. A auditoria
   * (LEVEL_APPROVE) registra sempre, independente da flag.
   */
  private get sodEnforce(): boolean {
    const value = this.config.get('SOD_ENFORCE');
    return value === true || value === 'true';
  }

  // ─── Resolve required approval levels for a document ─────────────────────

  async getRequiredLevels(companyId: string, entityType: string, amount: number) {
    const matrices = await this.prisma.approvalMatrix.findMany({
      where: { companyId, entityType },
      orderBy: { level: 'asc' },
    });
    return matrices.filter((m) => this.condicaoAtende(m, amount));
  }

  /**
   * O nível se aplica a este valor? AVALIADOR ÚNICO do par op+valor — o
   * approve() e o getPending() PRECISAM concordar sobre quais níveis valem,
   * senão a fila mostra documento que o botão nega (e vice-versa). Antes o
   * getPending tinha uma cópia que só entendia gte/lte: um nível `lt` criado
   * pela tela nova era "sempre aplicável" na fila e avaliado de verdade na
   * aprovação.
   */
  private condicaoAtende(
    m: { conditionField: string | null; conditionOp: string | null; conditionValue: string | null },
    amount: number,
  ): boolean {
    if (!m.conditionField || !m.conditionOp || !m.conditionValue) return true;
    if (m.conditionField !== 'amount') return true;
    const threshold = parseFloat(m.conditionValue);
    switch (m.conditionOp) {
      case 'gte': return amount >= threshold;
      case 'gt': return amount > threshold;
      case 'lte': return amount <= threshold;
      case 'lt': return amount < threshold;
      default: return true;
    }
  }

  // ─── Approve a document (PO, PR, EXPENSE) ───────────────────────────────

  async approve(
    documentId: string,
    documentType: string,
    companyId: string,
    userId: string,
  ) {
    // #227: Validate document exists, is in approvable status, and compute amount
    let amount = 0;
    let creatorId: string | null = null;
    if (documentType === 'PO') {
      const po = await this.prisma.purchaseOrder.findFirst({
        where: { id: documentId, companyId },
        include: { items: true },
      });
      if (!po) throw new NotFoundException(`PO ${documentId} não encontrada`);
      if (po.status !== 'DRAFT') {
        throw new BadRequestException(`PO não está em DRAFT (status: ${po.status})`);
      }
      amount = po.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitCost), 0);
      creatorId = po.createdById;
    } else if (documentType === 'PR') {
      const pr = await this.prisma.purchaseRequest.findFirst({
        where: { id: documentId, companyId },
        include: { product: true },
      });
      if (!pr) throw new NotFoundException(`PR ${documentId} não encontrada`);
      if (pr.status !== 'OPEN') {
        throw new BadRequestException(`PR não está em OPEN (status: ${pr.status})`);
      }
      amount = Number(pr.quantity) * Number(pr.product.costPrice ?? 0);
      creatorId = pr.requestedById;
    } else {
      throw new BadRequestException(`Tipo de documento não suportado: ${documentType}`);
    }

    // SoD (#160): quem criou o documento não pode aprová-lo — em NENHUM nível.
    // Aplica-se inclusive a SUPER_ADMIN (segregação de funções vale para todos os perfis).
    // Só vale com SOD_ENFORCE=true — por padrão a regra da empresa permite criar e aprovar.
    if (this.sodEnforce && creatorId && creatorId === userId) {
      throw new ForbiddenException(
        'Segregação de funções: o criador do documento não pode aprová-lo. Solicite a aprovação a outro usuário com alçada.',
      );
    }

    const requiredLevels = await this.getRequiredLevels(companyId, documentType, amount);

    if (requiredLevels.length === 0) {
      // Sem matriz de alçada configurada: aprova em nível único.
      //
      // #948-C1: aqui havia um portão por enum (SUPER_ADMIN/DIRECTOR/MANAGER),
      // redundante com a permissão `approvals.requests.approve` que a rota já
      // exige — e mais restritivo que ela. Quem chega até este ponto já passou
      // pelo PermissionGuard; barrar de novo pelo enum congelado só impedia
      // perfis v2 legítimos de aprovar.
      //
      // Isto é o portão GLOBAL. A matriz de alçada continua intacta logo
      // abaixo: quando existe, ela manda, e pode negar (ver `nextLevel`).
      return this.executeApproval(documentId, documentType, companyId, userId, 1);
    }

    // Find current approval state (how many levels already approved)
    const existingApprovals = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        entity: documentType,
        action: 'LEVEL_APPROVE',
        payload: { path: ['documentId'], equals: documentId },
      },
      orderBy: { createdAt: 'desc' },
    });

    // SoD (#160): um usuário que já aprovou um nível não pode aprovar outro nível
    // do mesmo documento — cada nível exige um aprovador distinto.
    // Só vale com SOD_ENFORCE=true — por padrão o mesmo usuário pode aprovar níveis distintos.
    if (this.sodEnforce && existingApprovals.some((a) => a.userId === userId)) {
      throw new ForbiddenException(
        'Segregação de funções: você já aprovou um nível deste documento. Cada nível de alçada exige um aprovador distinto.',
      );
    }

    const approvedLevels = existingApprovals.map(
      (a) => (a.payload as any)?.level ?? 0,
    );
    const nextLevel = requiredLevels.find(
      (l) => !approvedLevels.includes(l.level),
    );

    if (!nextLevel) {
      // Todos os níveis exigidos já constam aprovados na trilha, mas o
      // documento continua no status de origem. Isso é DERIVA de estado — o
      // caso real é a matriz ter sido renumerada/editada DEPOIS de aprovações
      // parciais (o CRUD da #1005 tornou isso possível). Lançar erro aqui
      // ("todas já concedidas") deixava o documento PRESO: nunca transiciona
      // e ninguém consegue aprovar. Finalizar é o comportamento que se cura
      // sozinho — e é coerente com o portão global (sem nível pendente, quem
      // tem a permissão da rota conclui).
      return this.executeApproval(
        documentId,
        documentType,
        companyId,
        userId,
        Math.max(...approvedLevels),
      );
    }

    // #1005: o nível exige um dos PERFIS v2 do usuário — DIRETOS, sem
    // herança, MESMA decisão de produto da alçada de desconto (#1004):
    // "Supervisor herda permissões de Gerente" não significa "Supervisor tem
    // a alçada de Gerente" — alçada é atribuída, não deduzida. Um perfil
    // filho que precise aprovar entra na matriz pelo PRÓPRIO code.
    // A resolução (com cache) só acontece quando HÁ matriz — a aprovação sem
    // matriz (portão global do #948-C1) não paga esse custo.
    const meusPerfis = await this.rolesDoUsuario(userId, companyId);
    if (!nextLevel.approverRoles.some((code) => meusPerfis.includes(code))) {
      const nomes = await this.nomesDosPerfis(companyId, nextLevel.approverRoles);
      throw new ForbiddenException(
        `O nível ${nextLevel.level} desta alçada exige um destes perfis: ${nomes}. ` +
          'Peça a aprovação a quem tenha um deles.',
      );
    }

    // Record approval
    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: documentType,
        action: 'LEVEL_APPROVE',
        // #1005: a trilha registra os PERFIS v2 de quem aprovou (o eixo real
        // da matriz), não mais o enum congelado.
        payload: { documentId, level: nextLevel.level, roles: meusPerfis },
      },
    });

    // Check if all levels are now approved
    const allApproved = requiredLevels.every(
      (l) => l.level === nextLevel.level || approvedLevels.includes(l.level),
    );

    if (allApproved) {
      return this.executeApproval(documentId, documentType, companyId, userId, nextLevel.level);
    }

    const remaining = requiredLevels.filter(
      (l) => l.level !== nextLevel.level && !approvedLevels.includes(l.level),
    );

    return {
      documentId,
      documentType,
      approvedLevel: nextLevel.level,
      status: 'PENDING_NEXT_LEVEL',
      remainingLevels: remaining.map((l) => ({
        level: l.level,
        requiredRoles: l.approverRoles,
      })),
    };
  }

  private async executeApproval(
    documentId: string,
    documentType: string,
    companyId: string,
    userId: string,
    finalLevel: number,
  ) {
    // #227: Execute approval for each supported document type
    if (documentType === 'PO') {
      await this.prisma.purchaseOrder.update({
        where: { id: documentId },
        data: {
          status: 'APPROVED',
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
    } else if (documentType === 'PR') {
      await this.prisma.purchaseRequest.update({
        where: { id: documentId },
        data: { status: 'APPROVED' },
      });
    }

    this.logger.log(`${documentType} ${documentId} aprovado (nível ${finalLevel}) por ${userId}`);

    return {
      documentId,
      documentType,
      approvedLevel: finalLevel,
      status: 'APPROVED',
      remainingLevels: [],
    };
  }

  // ─── Pending approvals for a user ───────────────────────────────────────

  async getPending(companyId: string, userId: string) {
    // #227: Fetch pending items for all supported document types
    // #1005: perfis v2 do usuário resolvidos UMA vez (cache), não por item.
    const [draftPOs, openPRs, allMatrices, meusPerfis] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: { companyId, status: 'DRAFT' },
        include: {
          items: true,
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.purchaseRequest.findMany({
        where: { companyId, status: 'OPEN' },
        include: {
          product: { select: { id: true, sku: true, name: true, costPrice: true } },
          requestedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.approvalMatrix.findMany({
        where: { companyId },
        orderBy: { level: 'asc' },
      }),
      this.rolesDoUsuario(userId, companyId),
    ]);
    const perfis = new Set(meusPerfis);

    // A fila precisa responder a MESMA pergunta que o approve() responde:
    // "qual é o PRÓXIMO nível pendente deste documento, e eu caso com ele?".
    // Para isso ela lê as aprovações parciais da trilha (LEVEL_APPROVE), como
    // o motor faz — senão um documento com nível 1 já aprovado continuaria na
    // fila de quem só aprova nível 1 (403 garantido no clique). A busca é
    // limitada pela criação do documento pendente mais antigo: aprovação
    // nunca antecede o documento.
    const pendentes = [...draftPOs, ...openPRs];
    const idsPendentes = new Set(pendentes.map((d) => d.id));
    const aprovadosPorDoc = new Map<string, number[]>();
    if (allMatrices.length > 0 && pendentes.length > 0) {
      const maisAntigo = pendentes.reduce(
        (min, d) => (d.createdAt < min ? d.createdAt : min),
        pendentes[0].createdAt,
      );
      // list-lint: ok (janela limitada pelo createdAt do pendente mais antigo; LEVEL_APPROVE é ação humana, volume mínimo — um take poderia descartar aprovação e ressuscitar nível já aprovado na fila)
      const trilha = await this.prisma.auditLog.findMany({
        where: {
          companyId,
          action: 'LEVEL_APPROVE',
          entity: { in: ['PO', 'PR'] },
          createdAt: { gte: maisAntigo },
        },
        select: { payload: true },
      });
      for (const t of trilha) {
        const p = t.payload as any;
        if (!p?.documentId || !idsPendentes.has(p.documentId)) continue;
        const lista = aprovadosPorDoc.get(p.documentId) ?? [];
        lista.push(p.level ?? 0);
        aprovadosPorDoc.set(p.documentId, lista);
      }
    }

    const filterByMatrix = (
      items: any[],
      entityType: string,
      getAmount: (item: any) => number,
    ) => {
      const matrices = allMatrices.filter((m) => m.entityType === entityType);
      return items
        .map((item) => {
          const amount = getAmount(item);
          const incluir = { ...item, documentType: entityType, totalAmount: amount };
          if (matrices.length === 0) return incluir; // sem matriz p/ o tipo: portão global
          // Nenhum nível casa com o VALOR: o approve() trata como nível único
          // (requiredLevels vazio) — a fila tem que mostrar, não esconder.
          const applicable = matrices.filter((m) => this.condicaoAtende(m, amount));
          if (applicable.length === 0) return incluir;
          const aprovados = aprovadosPorDoc.get(item.id) ?? [];
          const nextLevel = applicable.find((l) => !aprovados.includes(l.level));
          // Todos os níveis já aprovados mas o documento não transicionou
          // (deriva por edição da matriz): o approve() FINALIZA — mostra.
          if (!nextLevel) return incluir;
          const canApprove = nextLevel.approverRoles.some((code) => perfis.has(code));
          return canApprove ? incluir : null;
        })
        .filter(Boolean);
    };

    const pendingPOs = filterByMatrix(draftPOs, 'PO', (po) =>
      po.items.reduce((sum: number, i: any) => sum + Number(i.quantity) * Number(i.unitCost), 0),
    );
    const pendingPRs = filterByMatrix(openPRs, 'PR', (pr) =>
      Number(pr.quantity) * Number(pr.product?.costPrice ?? 0),
    );

    return [...pendingPOs, ...pendingPRs];
  }

  // ─── Matriz de alçadas (CRUD, #1005) ─────────────────────────────────────

  listMatrix(companyId: string) {
    return this.prisma.approvalMatrix.findMany({
      where: { companyId },
      orderBy: [{ entityType: 'asc' }, { level: 'asc' }],
    });
  }

  /**
   * Perfis oferecíveis como aprovadores na tela: os ATIVOS visíveis à empresa
   * (catálogo system global + perfis próprios da empresa).
   */
  roleOptions(companyId: string) {
    // tenant-lint: ok (perfis system são globais, companyId null; os demais
    // são filtrados pela própria empresa)
    return this.prisma.role.findMany({
      where: {
        isActive: true,
        OR: [{ companyId: null, isSystem: true }, { companyId }],
      },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async createMatrix(companyId: string, dto: CreateApprovalMatrixDto) {
    await this.validarPerfis(companyId, dto.approverRoles);
    await this.recusarNivelDuplicado(companyId, dto.entityType, dto.level);
    const condicao = this.montarCondicao(dto.conditionOp, dto.conditionValue);
    return this.prisma.approvalMatrix.create({
      data: {
        companyId,
        entityType: dto.entityType,
        level: dto.level,
        approverRoles: dto.approverRoles,
        ...condicao,
      },
    });
  }

  async updateMatrix(id: string, companyId: string, dto: UpdateApprovalMatrixDto) {
    const existente = await this.prisma.approvalMatrix.findFirst({ where: { id, companyId } });
    if (!existente) throw new NotFoundException(`Nível de alçada ${id} não encontrado`);
    if (dto.approverRoles) await this.validarPerfis(companyId, dto.approverRoles);
    if (dto.level !== undefined && dto.level !== existente.level) {
      await this.recusarNivelDuplicado(companyId, existente.entityType, dto.level, id);
    }

    // Condição é um PAR ATÔMICO: op+valor juntos trocam; op = null limpa;
    // omitir os dois mantém. Qualquer envio parcial é pedido malformado —
    // sem "completar com o que estava gravado", que dava respostas diferentes
    // para o mesmo payload dependendo do estado da linha.
    let condicao = {};
    if (dto.conditionOp !== undefined || dto.conditionValue !== undefined) {
      if (dto.conditionOp === null) {
        if (dto.conditionValue != null) {
          throw new BadRequestException(
            'Para limpar a condição de valor, envie só o operador nulo — sem valor junto.',
          );
        }
        condicao = { conditionField: null, conditionOp: null, conditionValue: null };
      } else if (dto.conditionOp === undefined || dto.conditionValue == null) {
        throw new BadRequestException(
          'Condição de valor incompleta: informe o operador e o valor juntos (ou operador nulo para limpar).',
        );
      } else {
        condicao = this.montarCondicao(dto.conditionOp, dto.conditionValue);
      }
    }

    return this.prisma.approvalMatrix.update({
      where: { id },
      data: {
        ...(dto.level !== undefined ? { level: dto.level } : {}),
        ...(dto.approverRoles ? { approverRoles: dto.approverRoles } : {}),
        ...condicao,
      },
    });
  }

  /**
   * O motor de aprovação identifica o estado pelo NÚMERO do nível
   * (`requiredLevels.find(...)` pega a primeira linha de cada número): uma
   * segunda linha com o mesmo nível ficaria MUDA no approve() e ainda
   * apareceria como configurada na tela. Sem unique no banco (seria
   * migration), o guarda fica aqui.
   */
  private async recusarNivelDuplicado(
    companyId: string,
    entityType: string,
    level: number,
    ignorarId?: string,
  ) {
    const duplicado = await this.prisma.approvalMatrix.findFirst({
      where: { companyId, entityType, level, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
      select: { id: true },
    });
    if (duplicado) {
      throw new BadRequestException(
        `Já existe um nível ${level} para este tipo de documento. Edite o nível existente ou use outro número.`,
      );
    }
  }

  async deleteMatrix(id: string, companyId: string) {
    const existente = await this.prisma.approvalMatrix.findFirst({ where: { id, companyId } });
    if (!existente) throw new NotFoundException(`Nível de alçada ${id} não encontrado`);
    await this.prisma.approvalMatrix.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Internos (#1005) ────────────────────────────────────────────────────

  /** Perfis v2 diretos do usuário (codes), via cache do PermissionService. */
  private async rolesDoUsuario(userId: string, companyId: string): Promise<string[]> {
    const { roles } = await this.permissions.getUserPermissions(userId, companyId);
    return roles;
  }

  /**
   * Nomes apresentáveis dos perfis de um nível (só no ramo de erro).
   *
   * ESCOPADO como as demais queries de Role deste service: `Role.code` só é
   * único POR EMPRESA — sem o escopo, o code "SUPERVISOR" de OUTRO tenant
   * poderia emprestar o nome à mensagem de erro desta empresa.
   */
  private async nomesDosPerfis(companyId: string, codes: string[]): Promise<string> {
    // tenant-lint: ok (perfis system são globais, companyId null)
    const roles = await this.prisma.role.findMany({
      where: {
        code: { in: codes },
        OR: [{ companyId: null, isSystem: true }, { companyId }],
      },
      select: { code: true, name: true },
    });
    const porCode = new Map(roles.map((r) => [r.code, r.name]));
    return codes.map((c) => porCode.get(c) ?? c).join(', ');
  }

  /**
   * Normaliza a condição de valor. Op e valor andam JUNTOS: um sem o outro é
   * pedido malformado, não default silencioso.
   */
  private montarCondicao(op?: string | null, valor?: number | null) {
    if (op == null && valor == null) {
      return { conditionField: null, conditionOp: null, conditionValue: null };
    }
    if (op == null || valor == null) {
      throw new BadRequestException(
        'Condição de valor incompleta: informe o operador e o valor juntos (ou nenhum dos dois).',
      );
    }
    return { conditionField: 'amount', conditionOp: op, conditionValue: String(valor) };
  }

  /** Todo code de aprovador precisa ser um perfil ATIVO visível à empresa. */
  private async validarPerfis(companyId: string, codes: string[]) {
    const unicos = [...new Set(codes)];
    // tenant-lint: ok (perfis system são globais, companyId null)
    const ativos = await this.prisma.role.findMany({
      where: {
        code: { in: unicos },
        isActive: true,
        OR: [{ companyId: null, isSystem: true }, { companyId }],
      },
      select: { code: true },
    });
    const encontrados = new Set(ativos.map((r) => r.code));
    const desconhecidos = unicos.filter((c) => !encontrados.has(c));
    if (desconhecidos.length > 0) {
      throw new BadRequestException(
        `Perfil não encontrado ou inativo: ${desconhecidos.join(', ')}. ` +
          'Use perfis ativos de Perfis e permissões.',
      );
    }
  }
}
