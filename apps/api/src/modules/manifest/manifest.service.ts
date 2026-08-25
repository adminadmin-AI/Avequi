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
import { FeatureFlag, FeatureFlagService } from '../../common/feature-flag/feature-flag.service';
import {
  PersistPageResult,
  ReceivedNfeSummary,
  ReceivedNfeSyncState,
  SyncAlreadyRunningError,
  manifestStatusFromFocus,
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

/**
 * Situações da Focus em que a nota NÃO é manifestável/pendente de verdade:
 * cancelada/denegada não entram na fila nem no alerta de "> 30 dias".
 */
const NON_MANIFESTABLE_SITUACOES = ['cancelada', 'denegada'];
const MANIFESTABLE_WHERE = { OR: [{ focusSituacao: null }, { focusSituacao: { notIn: NON_MANIFESTABLE_SITUACOES } }] };

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
    private readonly featureFlags: FeatureFlagService,
  ) {}

  // ─── Gate por company (Focus-A): default OFF ──────────────────────────────
  //
  // Flag canônica `focus.nfe_recebidas.enabled` em SystemParameter (mesmo
  // mecanismo do `renave.enabled`, fail-closed). Nenhum deploy liga sync
  // sozinho: o cron pula companies desligadas sem tocar em nada e o POST
  // manual devolve 409. Ligar/desligar é ato explícito via
  // PATCH /fiscal/manifest/sync/settings (permissão fiscal.manifestation.sync).

  async isSyncEnabled(companyId: string): Promise<boolean> {
    return this.featureFlags.isEnabled(companyId, FeatureFlag.FOCUS_NFE_RECEBIDAS_ENABLED);
  }

  async getSyncSettings(companyId: string): Promise<{ enabled: boolean }> {
    return { enabled: await this.isSyncEnabled(companyId) };
  }

  async updateSyncSettings(companyId: string, enabled: boolean, userId?: string): Promise<{ enabled: boolean }> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, cnpj: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada');
    if (enabled && (company.cnpj ?? '').replace(/\D/g, '').length !== 14) {
      throw new BadRequestException('Empresa sem CNPJ válido — não é possível habilitar a sincronização de NF-e recebidas');
    }
    await this.featureFlags.setEnabled(companyId, FeatureFlag.FOCUS_NFE_RECEBIDAS_ENABLED, enabled);
    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'SystemParameter',
        action: enabled ? 'FOCUS_NFE_RECEBIDAS_SYNC_ENABLED' : 'FOCUS_NFE_RECEBIDAS_SYNC_DISABLED',
        payload: { key: FeatureFlag.FOCUS_NFE_RECEBIDAS_ENABLED, enabled, userId: userId ?? null },
      },
    });
    this.logger.log(`Sync NF-e recebidas (Focus) ${enabled ? 'HABILITADO' : 'DESABILITADO'} para company=${companyId}`);
    return { enabled };
  }

  // ─── Focus-A (#608): sync INCREMENTAL de NF-e recebidas ──────────────────
  //
  // Cursor `versao` por company/CNPJ persistido em SystemParameter (estrutura
  // genérica já usada por feature flags e conectores): chave
  // `focus.nfe_recebidas.sync:<cnpj>`, valor JSON com cursor + observabilidade.
  // Paginação até esgotar, cursor só avança após persistir a página, falha da
  // Focus lança (nunca "0 notas"). Persistência: NfeManifest (camada de
  // "documentos detectados" já existente) — o destino fiscal continua sendo o
  // FiscalDocument via XML/parser da #1128, no Focus-B.

  async getSyncState(companyId: string): Promise<ReceivedNfeSyncState & { enabled: boolean }> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa não encontrada');
    const cnpj = (company.cnpj ?? '').replace(/\D/g, '');
    const [param, enabled] = await Promise.all([
      this.prisma.systemParameter.findUnique({ where: { companyId_key: { companyId, key: syncStateKey(cnpj) } } }),
      this.isSyncEnabled(companyId),
    ]);
    return { ...parseState(cnpj, param?.value ?? null), enabled };
  }

  /** Exclusão mútua EM PROCESSO por company (cron e POST no mesmo container). */
  private readonly syncInFlight = new Map<string, Promise<unknown>>();

  async syncReceivedNfes(companyId: string): Promise<{ synced: number; updated: number; total: number; cursorFrom: number; cursorTo: number; pages: number; state: ReceivedNfeSyncState }> {
    if (!(await this.isSyncEnabled(companyId))) {
      // gate: sem cursor, sem NfeManifest, sem estado FAILED — só recusa
      throw new ConflictException(
        `Sincronização de NF-e recebidas (Focus) desabilitada para a empresa ${companyId}. Habilite explicitamente em PATCH /fiscal/manifest/sync/settings.`,
      );
    }
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

  private async syncReceivedNfesExclusive(companyId: string): Promise<{ synced: number; updated: number; total: number; cursorFrom: number; cursorTo: number; pages: number; state: ReceivedNfeSyncState }> {
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
      persistPage: (items) => this.persistReceivedPage(companyId, items),
      saveState: async (state) => {
        await this.prisma.systemParameter.upsert({
          where: { companyId_key: { companyId, key } },
          update: { value: serializeState(state) },
          create: { companyId, key, value: serializeState(state) },
        });
      },
    });

    this.logger.log(
      `Sync NF-e recebidas company=${companyId} cnpj=${cnpj}: cursor ${result.cursorFrom}→${result.cursorTo}, ${result.pages} página(s), ${result.synced} novas + ${result.updated} alteradas de ${result.seen} vistas`,
    );
    return { synced: result.synced, updated: result.updated, total: result.seen, cursorFrom: result.cursorFrom, cursorTo: result.cursorTo, pages: result.pages, state: result.state };
  }

  /**
   * Persistência de UMA página (idempotente por companyId+chave). Invariantes:
   *  - chave nova → NfeManifest criado com o estado REAL da Focus (status
   *    derivado de `manifestacao_destinatario`, não PENDING artificial);
   *  - chave conhecida com `versao` MAIOR → alteração registrada de forma
   *    durável (focusVersion/focusChangedAt/situacao/manifestacao) ANTES de o
   *    cursor avançar — o Focus-B enxerga `focusVersion > focusProcessedVersion`;
   *  - chave conhecida com a MESMA versão → só `focusSeenAt` (reexecução não
   *    duplica nem perde sinal);
   *  - enriquecimento SEGURO: só preenche metadado vazio/nulo com o que a Focus
   *    devolveu agora (corrige os registros do mapeamento antigo); nunca
   *    sobrescreve valor já preenchido; nunca toca FiscalDocument;
   *  - status do ERP nunca é rebaixado: só PENDING → estado da Focus.
   */
  private async persistReceivedPage(companyId: string, items: ReceivedNfeSummary[]): Promise<PersistPageResult> {
    let created = 0;
    let updated = 0;
    const now = new Date();
    for (const it of items) {
      const before = await this.prisma.nfeManifest.findUnique({
        where: { companyId_chaveNfe: { companyId, chaveNfe: it.chave } },
        select: { id: true, status: true, focusVersion: true, supplierCnpj: true, nfeNumber: true, series: true, supplierName: true, issueDate: true, totalValue: true },
      });
      const focusStatus = manifestStatusFromFocus(it.manifestacao);
      if (before) {
        const versionUp = it.versao !== null && (before.focusVersion == null || it.versao > before.focusVersion);
        const data: Record<string, unknown> = { focusSeenAt: now };
        if (versionUp) {
          Object.assign(data, {
            focusVersion: it.versao,
            focusChangedAt: now,
            focusSituacao: it.situacao,
            focusManifestacao: it.manifestacao,
            focusNfeCompleta: it.nfeCompleta,
          });
          if (before.status === ManifestStatus.PENDING && focusStatus !== ManifestStatus.PENDING) data.status = focusStatus;
        }
        // enriquecimento seguro (só o que está vazio)
        if (!before.supplierCnpj && it.cnpjEmitente) data.supplierCnpj = it.cnpjEmitente;
        if (before.nfeNumber === null && it.numero) data.nfeNumber = it.numero;
        if (before.series === null && it.serie) data.series = it.serie;
        if (before.supplierName === null && it.nomeEmitente) data.supplierName = it.nomeEmitente;
        if (before.issueDate === null && it.dataEmissao) data.issueDate = new Date(it.dataEmissao);
        if (before.totalValue === null && it.valorTotal !== null) data.totalValue = it.valorTotal as any;
        await this.prisma.nfeManifest.update({ where: { id: before.id }, data });
        if (versionUp) updated++;
        continue;
      }
      try {
        await this.prisma.nfeManifest.create({
          data: {
            companyId,
            chaveNfe: it.chave,
            nfeNumber: it.numero,
            series: it.serie,
            supplierCnpj: it.cnpjEmitente ?? '',
            supplierName: it.nomeEmitente,
            issueDate: it.dataEmissao ? new Date(it.dataEmissao) : null,
            totalValue: it.valorTotal === null ? null : (it.valorTotal as any),
            status: focusStatus,
            focusVersion: it.versao,
            focusSituacao: it.situacao,
            focusManifestacao: it.manifestacao,
            focusNfeCompleta: it.nfeCompleta,
            focusSeenAt: now,
            focusChangedAt: now,
          },
        });
      } catch (err) {
        // corrida perdida com outra escrita da mesma chave: já existe → idempotente
        if ((err as { code?: string }).code === 'P2002') continue;
        throw err;
      }
      created++;
    }
    return { created, updated };
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
      where: { companyId, status: ManifestStatus.PENDING, ...MANIFESTABLE_WHERE },
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
        ...MANIFESTABLE_WHERE,
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
          ...MANIFESTABLE_WHERE,
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
