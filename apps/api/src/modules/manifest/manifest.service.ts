import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalClientService } from '../fiscal/fiscal-client.service';

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
    private readonly fiscalClient: FiscalClientService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Sync: buscar NF-e destinadas via Focus NFe ──────────────────────────

  async syncReceivedNfes(companyId: string): Promise<{ synced: number; total: number }> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa não encontrada');

    const cnpj = company.cnpj.replace(/\D/g, '');
    const received = await this.fiscalClient.fetchReceivedNfes(cnpj);

    if (!Array.isArray(received)) {
      this.logger.warn(`Focus NFe retornou formato inesperado para NF-e recebidas: ${typeof received}`);
      return { synced: 0, total: 0 };
    }

    let synced = 0;

    for (const nfe of received) {
      const chave = nfe.chave ?? nfe.chave_nfe;
      if (!chave) continue;

      const existing = await this.prisma.nfeManifest.findUnique({
        where: { companyId_chaveNfe: { companyId, chaveNfe: chave } },
      });

      if (existing) continue;

      await this.prisma.nfeManifest.create({
        data: {
          companyId,
          chaveNfe: chave,
          nfeNumber: nfe.numero ?? null,
          series: nfe.serie ?? null,
          supplierCnpj: nfe.cnpj_emitente ?? '',
          supplierName: nfe.nome_emitente ?? null,
          issueDate: nfe.data_emissao ? new Date(nfe.data_emissao) : null,
          totalValue: nfe.valor_total ?? null,
          status: ManifestStatus.PENDING,
        },
      });

      synced++;
    }

    this.logger.log(`Sync NF-e recebidas company=${companyId}: ${synced} novas de ${received.length} total`);
    return { synced, total: received.length };
  }

  // ─── Ciência da Operação ──────────────────────────────────────────────────

  async registerCiencia(chaveNfe: string, companyId: string, userId: string): Promise<void> {
    const manifest = await this.findManifestOrFail(chaveNfe, companyId);

    if (manifest.status !== ManifestStatus.PENDING) {
      throw new BadRequestException(
        `NF-e já manifestada com status ${manifest.status}. Ciência só pode ser registrada em NF-e PENDING.`,
      );
    }

    const response = await this.fiscalClient.manifestNfe(chaveNfe, MANIFEST_EVENTS.CIENCIA);

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

    const response = await this.fiscalClient.manifestNfe(chaveNfe, MANIFEST_EVENTS.CONFIRMACAO);

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
