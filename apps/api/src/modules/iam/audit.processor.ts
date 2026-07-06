import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { AuditService } from './audit.service';
import { AUDIT_JOB_PERSIST, AUDIT_QUEUE, AuditLogEntry } from './audit.types';

/**
 * Worker da AUDIT_QUEUE (issue #343, Decisão 5): consome as entradas
 * enfileiradas pelo AuditService.log() e persiste em gdr_audit_logs_v2.
 *
 * Erro de banco AQUI deve LANÇAR: é o que aciona o retry com backoff do Bull
 * (attempts: 3, exponencial). Job que esgota as tentativas fica retido na
 * fila de falhos (removeOnFail: false) para inspeção — dead-letter de fato.
 *
 * Mesmo padrão do ReportProcessor (fila que já roda em produção).
 */
@Processor(AUDIT_QUEUE)
export class AuditProcessor {
  private readonly logger = new Logger(AuditProcessor.name);

  constructor(private readonly auditService: AuditService) {}

  @Process(AUDIT_JOB_PERSIST)
  async handlePersist(job: Job<AuditLogEntry>): Promise<void> {
    try {
      await this.auditService.persist(job.data);
    } catch (err) {
      this.logger.warn(
        `[job:${job.id}] Falha ao persistir audit log de ${job.data.entity}/${job.data.action} (tentativa ${job.attemptsMade + 1}): ${(err as Error).message}`,
      );
      throw err; // deixa o Bull fazer retry/backoff
    }
  }
}
