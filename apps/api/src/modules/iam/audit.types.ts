import { AuditAction } from '@prisma/client';

/**
 * Fila de auditoria (issue #343, Decisão 5 da arquitetura IAM v2):
 * mutations de negócio são persistidas de forma ASSÍNCRONA via Bull —
 * mesma infra da REPORT_QUEUE que já roda em produção.
 */
export const AUDIT_QUEUE = 'audit';

/** Nome do job de persistência consumido pelo AuditProcessor. */
export const AUDIT_JOB_PERSIST = 'persist';

/**
 * Entrada de auditoria — espelha os campos do model AuditLogV2
 * (tabela gdr_audit_logs_v2, criada na #337/#462).
 *
 * `oldValue`/`newValue` devem chegar JÁ reduzidos ao diff (só campos
 * alterados) e com campos sensíveis redigidos — use `computeDiff()` de
 * audit-diff.util.ts ou o `AuditService.logWithDiff()`.
 */
export interface AuditLogEntry {
  companyId: string;
  userId?: string | null;
  sessionId?: string | null;
  entity: string;
  entityId?: string | null;
  action: AuditAction;
  module?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  duration?: number | null;
}
