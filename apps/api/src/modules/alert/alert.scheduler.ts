import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AlertService } from './alert.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MrpService } from '../mrp/mrp.service';
import { ManifestService } from '../manifest/manifest.service';
import { REPORT_QUEUE } from '../report/report.types';

const FOCUS_NFE_HEALTH_URL = 'https://homologacao.focusnfe.com.br/v2/';
const FOCUS_NFE_PING_TIMEOUT_MS = 5_000;

@Injectable()
export class AlertScheduler {
  private readonly logger = new Logger(AlertScheduler.name);

  constructor(
    private readonly alertService: AlertService,
    private readonly prisma: PrismaService,
    private readonly mrpService: MrpService,
    private readonly manifestService: ManifestService,
    @InjectQueue(REPORT_QUEUE) private readonly reportQueue: Queue,
  ) {}

  // ─── helper: busca todas as empresas ativas ───────────────────────────────

  private async getActiveCompanies(): Promise<{ id: string }[]> {
    return this.prisma.company.findMany({
      select: { id: true },
    });
  }

  // ─── S24.A: MRP automático diário às 06h ─────────────────────────────────

  @Cron('0 6 * * *', { name: 'mrp-daily' })
  async runDailyMrp(): Promise<void> {
    this.logger.log('MRP diário: iniciando...');
    const companies = await this.getActiveCompanies();

    for (const company of companies) {
      try {
        const { runId } = await this.mrpService.run(company.id);

        // Aguarda conclusão para contar sugestões (MRP é síncrono internamente)
        // Notificação emitida pelo listener MRP no serviço de alertas
        this.logger.log(`MRP Run ${runId} enfileirado para company ${company.id}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Falha no MRP diário para ${company.id}: ${msg}`);
      }
    }
  }

  // ─── S24.B: Alertas de CP vencendo — diariamente às 08h ──────────────────

  @Cron('0 8 * * *', { name: 'payable-due-check' })
  async checkPayableDue(): Promise<void> {
    const companies = await this.getActiveCompanies();
    let total = 0;

    for (const company of companies) {
      total += await this.alertService.checkPayableDue(company.id);
    }

    if (total > 0) {
      this.logger.warn(`Alertas CP vencendo: ${total} novos`);
    }
  }

  // ─── S24.C: Estoque mínimo — a cada 30 min ───────────────────────────────

  @Cron('*/30 * * * *', { name: 'stock-min-check' })
  async checkStockMin(): Promise<void> {
    const companies = await this.getActiveCompanies();
    let total = 0;

    for (const company of companies) {
      total += await this.alertService.checkStockMin(company.id);
    }

    if (total > 0) {
      this.logger.warn(`Alertas estoque mínimo: ${total} novos`);
    }
  }

  // ─── S24.D: OPs atrasadas — a cada 30 min ────────────────────────────────

  @Cron('*/30 * * * *', { name: 'production-late-check' })
  async checkProductionLate(): Promise<void> {
    const companies = await this.getActiveCompanies();
    let total = 0;

    for (const company of companies) {
      total += await this.alertService.checkProductionLate(company.id);
    }

    if (total > 0) {
      this.logger.warn(`Alertas OP atrasada: ${total} novos`);
    }
  }

  // ─── S24.E: NF-e rejeitadas — a cada 15 min ──────────────────────────────

  @Cron('*/15 * * * *', { name: 'nfe-rejected-check' })
  async checkNfeRejected(): Promise<void> {
    const companies = await this.getActiveCompanies();
    let total = 0;

    for (const company of companies) {
      total += await this.alertService.checkNfeRejected(company.id);
    }

    if (total > 0) {
      this.logger.warn(`Alertas NF-e rejeitada: ${total} novos`);
    }
  }

  // ─── S24.F: Health check Focus NFe — a cada 5 min ────────────────────────

  @Cron('*/5 * * * *', { name: 'focus-nfe-health' })
  async healthCheckFocusNfe(): Promise<void> {
    const companies = await this.getActiveCompanies();
    let isUp = false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        FOCUS_NFE_PING_TIMEOUT_MS,
      );

      const res = await fetch(FOCUS_NFE_HEALTH_URL, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      isUp = res.status < 500;
    } catch {
      isUp = false;
    }

    for (const company of companies) {
      if (!isUp) {
        await this.alertService.alertFocusNfeDown(
          company.id,
          `Focus NFe não respondeu em ${FOCUS_NFE_PING_TIMEOUT_MS}ms`,
        );
      } else {
        await this.alertService.resolveFocusNfeAlert(company.id);
      }
    }
  }

  // ─── F6: Sync NF-e recebidas — diariamente às 07h ────────────────────────

  @Cron('0 7 * * *', { name: 'manifest-sync' })
  async syncManifests(): Promise<void> {
    this.logger.log('Sync manifestação: iniciando...');
    const companies = await this.getActiveCompanies();

    for (const company of companies) {
      try {
        const { synced } = await this.manifestService.syncReceivedNfes(company.id);
        if (synced > 0) {
          this.logger.log(`Manifest sync company=${company.id}: ${synced} novas NF-e`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Falha no sync manifestação para ${company.id}: ${msg}`);
      }
    }
  }

  // ─── F6: Alerta NF-e não manifestada > 30 dias — diariamente às 09h ──────

  @Cron('0 9 * * *', { name: 'manifest-overdue-check' })
  async checkManifestOverdue(): Promise<void> {
    const companies = await this.getActiveCompanies();
    let total = 0;

    for (const company of companies) {
      try {
        const count = await this.manifestService.checkOverdueManifests(company.id);
        if (count > 0) {
          await this.alertService.alertManifestOverdue(company.id, count);
          total += count;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Falha no check manifestação vencida para ${company.id}: ${msg}`);
      }
    }

    if (total > 0) {
      this.logger.warn(`Alertas manifestação vencida: ${total} NF-e`);
    }
  }
}
