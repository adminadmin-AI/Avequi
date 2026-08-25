import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EMISSOR_PORT, EmissorPort } from '../fiscal/emissor.port';
import {
  ReceivedNfeSummary,
  ReceivedNfeSyncState,
  SyncAlreadyRunningError,
  normalizeReceivedItem,
  parseState,
  runIncrementalSync,
  serializeState,
  syncStateKey,
} from './received-nfe-sync.core';

/**
 * Lease da sincronização (Focus-A): uma execução RUNNING cuja linha de estado
 * foi atualizada há menos que isto bloqueia outra execução para a mesma
 * company (cron × POST manual). Como o estado é regravado a cada página, uma
 * execução viva renova o lease sozinha; um processo morto libera após o prazo.
 */
export const SYNC_LEASE_MS = 30 * 60 * 1000;

/** Focus NFe manifest event codes */
const MANIFEST_EVENTS = {
  CIENCIA: 210210,
  CONFIRMACAO: 210200,
  OPERACAO_NAO_REALIZADA: 210220,
  DESCONHECIMENTO: 210240,
} as const;

/** Status values as string literals (runtime-safe, avoids Prisma enum import timing issues) */
const ManifestStatus = {
  PENDING: 'PENDING' as const,
  CIENCIA: 'CIENCIA' as const,
  CONFIRMED: 'CONFIRMED' as const,
  NOT_PERFORMED: 'NOT_PERFORMED' as const,
  UNKNOWN: 'UNKNOWN' as const,
};

const ManifestEventType = {
  CIENCIA: 'CIENCIA' as const,
  CONFIRMACAO: 'CONFIRMACAO' as const,
  OPERACAO_NAO_REALIZADA: 'OPERACAO_NAO_REALIZADA' as const,
  DESCONHECIMENTO: 'DESCONHECIMENTO' as const,
};

export const MANIFEST_CONFIRMED_EVENT = 'manifest.confirmed';

@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMISSOR_PORT) private readonly fiscalClient: EmissorPort,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Focus-A (#608): sync INCREMENTAL de NF-e recebidas ──────────────────
  //
  // Cursor `versao` por company/CNPJ persistido em SystemParameter (estrutura
  // genérica já usada por feature flags e conectores): chave
  // `focus.nfe_recebidas.sync:<cnpj>`, valor JSON com cursor + observabilidade.
  // Paginação até esgotar, cursor só avança após persistir a página, falha da
  // Focus lança (nunca "0 notas"). Persistência: NfeManifest (camada de
  // "documentos detectados" já existente) — o destino fiscal continua sendo o
  // FiscalDocument via XML/parser da #1128, no Focus-B.

  async getSyncState(companyId: string): Promise<ReceivedNfeSyncState> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa não encontrada');
    const cnpj = (company.cnpj ?? '').replace(/\D/g, '');
    const param = await this.prisma.systemParameter.findUnique({
      where: { companyId_key: { companyId, key: syncStateKey(cnpj) } },
    });
    return parseState(cnpj, param?.value ?? null);
  }

  /** Exclusão mútua EM PROCESSO por company (cron e POST no mesmo container). */
  private readonly syncInFlight = new Map<string, Promise<unknown>>();

  async syncReceivedNfes(companyId: string): Promise<{ synced: number; total: number; cursorFrom: number; cursorTo: number; pages: number; state: ReceivedNfeSyncState }> {
    if (this.syncInFlight.has(companyId)) {
      throw new ConflictException(`Sincronização de NF-e recebidas já em execução para a empresa ${companyId}`);
    }
    const run = this.syncReceivedNfesExclusive(companyId);
    this.syncInFlight.set(companyId, run.catch(() => undefined));
    try {
      return await run;
    } finally {
      this.syncInFlight.delete(companyId);
    }
  }

  /**
   * Lease ENTRE processos/instâncias: só entra quem conseguir trocar o estado
   * persistido de (não-RUNNING, ou RUNNING vencido) para RUNNING com um
   * compare-and-swap no valor anterior (`UPDATE … WHERE value = <lido>`),
   * mesmo padrão de guarda otimista já usado nos importadores fiscais. Duas
   * execuções simultâneas leem o mesmo valor; só uma troca — a outra recebe 409.
   */
  private async acquireSyncLease(companyId: string, key: string, cnpj: string): Promise<ReceivedNfeSyncState> {
    const now = new Date();
    const param = await this.prisma.systemParameter.findUnique({ where: { companyId_key: { companyId, key } } });
    const start = parseState(cnpj, param?.value ?? null);
    const touchedAt: Date | null = param?.updatedAt ?? null;
    if (start.lastRunStatus === 'RUNNING' && touchedAt && now.getTime() - touchedAt.getTime() < SYNC_LEASE_MS) {
      throw new SyncAlreadyRunningError(cnpj, start.lastSyncAt);
    }
    const running = serializeState({ ...start, lastRunStatus: 'RUNNING', lastSyncAt: now.toISOString(), lastError: null });
    if (param) {
      const r = await this.prisma.systemParameter.updateMany({
        where: { companyId, key, value: param.value },
        data: { value: running },
      });
      if (r.count !== 1) throw new SyncAlreadyRunningError(cnpj, null);
    } else {
      try {
        await this.prisma.systemParameter.create({ data: { companyId, key, value: running } });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') throw new SyncAlreadyRunningError(cnpj, null);
        throw err;
      }
    }
    return start;
  }

  private async syncReceivedNfesExclusive(companyId: string): Promise<{ synced: number; total: number; cursorFrom: number; cursorTo: number; pages: number; state: ReceivedNfeSyncState }> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa não encontrada');
    const cnpj = (company.cnpj ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) throw new BadRequestException(`Empresa ${companyId} sem CNPJ válido para consultar NF-e recebidas`);
    const key = syncStateKey(cnpj);

    let start: ReceivedNfeSyncState;
    try {
      start = await this.acquireSyncLease(companyId, key, cnpj);
    } catch (err) {
      if (err instanceof SyncAlreadyRunningError) throw new ConflictException(err.message);
      throw err;
    }

    const result = await runIncrementalSync(start, {
      now: () => new Date(),
      fetchPage: async (cursor) => {
        const raw = await this.fiscalClient.fetchReceivedNfesPage(cnpj, cursor, companyId);
        const items = raw.items.map(normalizeReceivedItem).filter((i): i is ReceivedNfeSummary => i !== null);
        return { items, maxVersion: raw.maxVersion, totalCount: raw.totalCount };
      },
      persistPage: async (items) => {
        let created = 0;
        for (const it of items) {
          // idempotente por (companyId, chave): existente → nada muda (status e
          // manifestação são do ERP, não da listagem); novo → PENDING.
          const before = await this.prisma.nfeManifest.findUnique({
            where: { companyId_chaveNfe: { companyId, chaveNfe: it.chave } },
            select: { id: true },
          });
          if (before) continue;
          try {
            await this.prisma.nfeManifest.upsert({
              where: { companyId_chaveNfe: { companyId, chaveNfe: it.chave } },
              update: {},
              create: {
                companyId,
                chaveNfe: it.chave,
                nfeNumber: it.numero,
                series: it.serie,
                supplierCnpj: it.cnpjEmitente ?? '',
                supplierName: it.nomeEmitente,
                issueDate: it.dataEmissao ? new Date(it.dataEmissao) : null,
                totalValue: it.valorTotal === null ? null : (it.valorTotal as any),
                status: ManifestStatus.PENDING,
              },
            });
          } catch (err) {
            // corrida perdida com outra escrita da mesma chave: já existe → idempotente
            if ((err as { code?: string }).code === 'P2002') continue;
            throw err;
          }
          created++;
        }
        return created;
      },
      saveState: async (state) => {
        await this.prisma.systemParameter.upsert({
          where: { companyId_key: { companyId, key } },
          update: { value: serializeState(state) },
          create: { companyId, key, value: serializeState(state) },
        });
      },
    });

    this.logger.log(
      `Sync NF-e recebidas company=${companyId} cnpj=${cnpj}: cursor ${result.cursorFrom}→${result.cursorTo}, ${result.pages} página(s), ${result.synced} novas de ${result.seen} vistas`,
    );
    return { synced: result.synced, total: result.seen, cursorFrom: result.cursorFrom, cursorTo: result.cursorTo, pages: result.pages, state: result.state };
  }

  // ─── Ciência da Operação ──────────────────────────────────────────────────

  async registerCiencia(chaveNfe: string, companyId: string, userId: string): Promise<void> {
    const manifest = await this.findManifestOrFail(chaveNfe, companyId);

    if (manifest.status !== ManifestStatus.PENDING) {
      throw new BadRequestException(
        `NF-e já manifestada com status ${manifest.status}. Ciência só pode ser registrada em NF-e PENDING.`,
      );
    }

    const response = await this.fiscalClient.manifestNfe(chaveNfe, MANIFEST_EVENTS.CIENCIA, undefined, companyId);

    if (response.status === 'erro') {
      throw new BadRequestException(`Erro ao registrar ciência na SEFAZ: ${response.motivo}`);
    }

    await this.prisma.nfeManifest.update({
      where: { id: manifest.id },
      data: {
        status: ManifestStatus.CIENCIA,
        lastEventType: ManifestEventType.CIENCIA,
        lastEventDate: new Date(),
        protocol: response.protocolo ?? response.chave_nfe ?? null,
        manifestedById: userId,
      },
    });

    await this.createAuditLog(companyId, manifest.id, 'CIENCIA', chaveNfe);
  }

  // ─── Confirmação da Operação ──────────────────────────────────────────────

  async confirmOperation(chaveNfe: string, companyId: string, userId: string): Promise<void> {
    const manifest = await this.findManifestOrFail(chaveNfe, companyId);

    if (manifest.status !== ManifestStatus.PENDING && manifest.status !== ManifestStatus.CIENCIA) {
      throw new BadRequestException(
        `NF-e com status ${manifest.status} não pode ser confirmada. Apenas PENDING ou CIENCIA.`,
      );
    }

    const response = await this.fiscalClient.manifestNfe(chaveNfe, MANIFEST_EVENTS.CONFIRMACAO, undefined, companyId);

    if (response.status === 'erro') {
      throw new BadRequestException(`Erro ao confirmar operação na SEFAZ: ${response.motivo}`);
    }

    await this.prisma.nfeManifest.update({
      where: { id: manifest.id },
      data: {
        status: ManifestStatus.CONFIRMED,
        lastEventType: ManifestEventType.CONFIRMACAO,
        lastEventDate: new Date(),
        protocol: response.protocolo ?? response.chave_nfe ?? null,
        manifestedById: userId,
      },
    });

    await this.createAuditLog(companyId, manifest.id, 'CONFIRM', chaveNfe);

    this.eventEmitter.emit(MANIFEST_CONFIRMED_EVENT, {
      companyId,
      chaveNfe,
      manifestId: manifest.id,
    });
  }

  // ─── Operação Não Realizada ───────────────────────────────────────────────

  async rejectOperation(
    chaveNfe: string,
    companyId: string,
    userId: string,
    justificativa: string,
  ): Promise<void> {
    const manifest = await this.findManifestOrFail(chaveNfe, companyId);

    if (manifest.status === ManifestStatus.NOT_PERFORMED || manifest.status === ManifestStatus.UNKNOWN) {
      throw new BadRequestException(`NF-e já manifestada como ${manifest.status}`);
    }

    const response = await this.fiscalClient.manifestNfe(
      chaveNfe,
      MANIFEST_EVENTS.OPERACAO_NAO_REALIZADA,
      justificativa,
      companyId,
    );

    if (response.status === 'erro') {
      throw new BadRequestException(`Erro ao registrar operação não realizada: ${response.motivo}`);
    }

    await this.prisma.nfeManifest.update({
      where: { id: manifest.id },
      data: {
        status: ManifestStatus.NOT_PERFORMED,
        lastEventType: ManifestEventType.OPERACAO_NAO_REALIZADA,
        lastEventDate: new Date(),
        justification: justificativa,
        protocol: response.protocolo ?? response.chave_nfe ?? null,
        manifestedById: userId,
      },
    });

    await this.createAuditLog(companyId, manifest.id, 'REJECT', chaveNfe);
  }

  // ─── Desconhecimento da Operação ──────────────────────────────────────────

  async unknownOperation(
    chaveNfe: string,
    companyId: string,
    userId: string,
    justificativa: string,
  ): Promise<void> {
    const manifest = await this.findManifestOrFail(chaveNfe, companyId);

    if (manifest.status === ManifestStatus.CONFIRMED) {
      throw new BadRequestException('NF-e já confirmada não pode ser desconhecida');
    }
    if (manifest.status === ManifestStatus.UNKNOWN) {
      throw new BadRequestException('NF-e já marcada como desconhecida');
    }

    const response = await this.fiscalClient.manifestNfe(
      chaveNfe,
      MANIFEST_EVENTS.DESCONHECIMENTO,
      justificativa,
      companyId,
    );

    if (response.status === 'erro') {
      throw new BadRequestException(`Erro ao registrar desconhecimento: ${response.motivo}`);
    }

    await this.prisma.nfeManifest.update({
      where: { id: manifest.id },
      data: {
        status: ManifestStatus.UNKNOWN,
        lastEventType: ManifestEventType.DESCONHECIMENTO,
        lastEventDate: new Date(),
        justification: justificativa,
        protocol: response.protocolo ?? response.chave_nfe ?? null,
        manifestedById: userId,
      },
    });

    await this.createAuditLog(companyId, manifest.id, 'UNKNOWN', chaveNfe);
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  async findPending(companyId: string) {
    return this.prisma.nfeManifest.findMany({
      where: { companyId, status: ManifestStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(companyId: string, status?: string) {
    return this.prisma.nfeManifest.findMany({
      where: {
        companyId,
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOverdue(companyId: string, days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return this.prisma.nfeManifest.findMany({
      where: {
        companyId,
        status: ManifestStatus.PENDING,
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getStats(companyId: string) {
    const [pending, ciencia, confirmed, notPerformed, unknown, overdue] = await Promise.all([
      this.prisma.nfeManifest.count({ where: { companyId, status: ManifestStatus.PENDING } }),
      this.prisma.nfeManifest.count({ where: { companyId, status: ManifestStatus.CIENCIA } }),
      this.prisma.nfeManifest.count({ where: { companyId, status: ManifestStatus.CONFIRMED } }),
      this.prisma.nfeManifest.count({ where: { companyId, status: ManifestStatus.NOT_PERFORMED } }),
      this.prisma.nfeManifest.count({ where: { companyId, status: ManifestStatus.UNKNOWN } }),
      this.prisma.nfeManifest.count({
        where: {
          companyId,
          status: ManifestStatus.PENDING,
          createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return { pending, ciencia, confirmed, notPerformed, unknown, overdue };
  }

  // ─── Alerta: NF-e não manifestada > 30 dias ──────────────────────────────

  async checkOverdueManifests(companyId: string): Promise<number> {
    const overdue = await this.findOverdue(companyId);
    return overdue.length;
  }

  // ─── Privado ──────────────────────────────────────────────────────────────

  private async findManifestOrFail(chaveNfe: string, companyId: string) {
    const manifest = await this.prisma.nfeManifest.findUnique({
      where: { companyId_chaveNfe: { companyId, chaveNfe } },
    });

    if (!manifest) {
      throw new NotFoundException(`NF-e com chave ${chaveNfe} não encontrada para manifestação`);
    }

    return manifest;
  }

  private async createAuditLog(companyId: string, manifestId: string, action: string, chaveNfe: string) {
    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'NfeManifest',
        action,
        payload: { manifestId, chaveNfe },
      },
    });
  }
}
