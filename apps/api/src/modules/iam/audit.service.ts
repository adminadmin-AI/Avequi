import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { computeDiff, redactSensitive } from './audit-diff.util';
import { AUDIT_JOB_PERSIST, AUDIT_QUEUE, AuditLogEntry } from './audit.types';

/**
 * AuditService — issue #343 (Fase F3.4/M5 do IAM v2).
 *
 * Persistência REAL de auditoria em AuditLogV2 (gdr_audit_logs_v2), seguindo
 * a Decisão 5 da arquitetura (docs/iam/ARQUITETURA-IAM-V2.md):
 *
 *   caminho padrão  → log() ENFILEIRA no Bull (AUDIT_QUEUE) e o
 *                     AuditProcessor persiste com retry + backoff;
 *   Redis fora      → fallback SÍNCRONO (grava direto no banco — degrada
 *                     latência, não perde log);
 *   banco fora      → log estruturado de erro. Auditoria é best-effort por
 *                     design: NUNCA derruba a request de negócio.
 *
 * SecurityEvent e PermissionChangeLog NÃO passam por aqui: são síncronos na
 * transação da ação (Decisão 5) — ver SessionService/futuro PermissionService.
 *
 * ── Adoção gradual de diff nos services ──────────────────────────────────
 * O AuditInterceptor global audita request/response (sem estado "antes").
 * Para trilha com diff de verdade, os services chamam `logWithDiff(before,
 * after, base)` — exemplo real em SessionService.revokeSession(). NÃO
 * instrumente os 33 módulos de uma vez: adote conforme cada módulo for
 * tocado (evita conflito com PRs pendentes).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectQueue(AUDIT_QUEUE) private readonly auditQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Registra uma entrada de auditoria. Nunca lança: fila → fallback síncrono
   * → log de erro estruturado (nesta ordem).
   */
  async log(entry: AuditLogEntry): Promise<void> {
    // Defesa em profundidade: mesmo que o chamador não tenha redigido,
    // nenhum campo sensível chega ao Redis/banco em claro.
    const safeEntry: AuditLogEntry = {
      ...entry,
      oldValue: entry.oldValue === undefined ? undefined : redactSensitive(entry.oldValue),
      newValue: entry.newValue === undefined ? undefined : redactSensitive(entry.newValue),
    };

    try {
      await this.auditQueue.add(AUDIT_JOB_PERSIST, safeEntry, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false, // job falho fica visível (dead-letter de fato)
      });
    } catch (queueError) {
      // Redis indisponível → fallback síncrono (Decisão 5: degrada, não perde).
      try {
        await this.persist(safeEntry);
        this.logger.warn(
          `AUDIT_QUEUE indisponível — log de ${safeEntry.entity}/${safeEntry.action} persistido de forma síncrona (${(queueError as Error).message})`,
        );
      } catch (dbError) {
        // Último recurso: erro estruturado no console (nunca derruba a request).
        this.logger.error({
          message: 'Falha total ao persistir audit log (fila E banco indisponíveis)',
          queueError: (queueError as Error).message,
          dbError: (dbError as Error).message,
          entry: {
            companyId: safeEntry.companyId,
            userId: safeEntry.userId,
            entity: safeEntry.entity,
            entityId: safeEntry.entityId,
            action: safeEntry.action,
            requestId: safeEntry.requestId,
          },
        });
      }
    }
  }

  /**
   * Registra auditoria COM diff before/after: grava apenas os campos
   * alterados, com redação de sensíveis (computeDiff). Se nada mudou,
   * não registra (UPDATE sem efeito não é evento auditável).
   *
   * Exemplo de adoção real: SessionService.revokeSession().
   */
  async logWithDiff(
    before: unknown,
    after: unknown,
    base: Omit<AuditLogEntry, 'oldValue' | 'newValue'>,
  ): Promise<void> {
    const diff = computeDiff(before, after);
    if (!diff) return;
    await this.log({ ...base, oldValue: diff.oldValue, newValue: diff.newValue });
  }

  /**
   * Persistência direta em gdr_audit_logs_v2. Usada pelo AuditProcessor
   * (caminho async) e pelo fallback síncrono. Lança em erro de banco —
   * quem decide o que fazer é o chamador (retry do Bull ou log de erro).
   */
  async persist(entry: AuditLogEntry): Promise<void> {
    await this.prisma.auditLogV2.create({
      data: {
        companyId: entry.companyId,
        userId: entry.userId ?? null,
        sessionId: entry.sessionId ?? null,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        action: entry.action,
        module: entry.module ?? null,
        oldValue:
          entry.oldValue === undefined || entry.oldValue === null
            ? Prisma.JsonNull
            : (entry.oldValue as Prisma.InputJsonValue),
        newValue:
          entry.newValue === undefined || entry.newValue === null
            ? Prisma.JsonNull
            : (entry.newValue as Prisma.InputJsonValue),
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        requestId: entry.requestId ?? null,
        duration: entry.duration ?? null,
      },
    });
  }

  /**
   * Consulta paginada dos audit logs da empresa (endpoint GET /iam/audit-logs,
   * restrito a SUPER_ADMIN). Filtros: entity, entityId, userId, action,
   * período (from/to). Sempre escopado por companyId (multi-tenant).
   */
  async findLogs(
    companyId: string,
    filters: {
      entity?: string;
      entityId?: string;
      userId?: string;
      action?: AuditAction;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = Math.min(filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 50, 200);

    const where: Prisma.AuditLogV2WhereInput = { companyId };
    if (filters.entity) where.entity = filters.entity;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.userId) where.userId = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.auditLogV2.count({ where }),
      this.prisma.auditLogV2.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }
}
