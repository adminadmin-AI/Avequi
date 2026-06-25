import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { randomBytes } from 'crypto';

const ConsentStatus = {
  ACTIVE: 'ACTIVE' as const,
  REVOKED: 'REVOKED' as const,
  EXPIRED: 'EXPIRED' as const,
};

const AnonymizationStatus = {
  REQUESTED: 'REQUESTED' as const,
  PROCESSING: 'PROCESSING' as const,
  COMPLETED: 'COMPLETED' as const,
  DENIED: 'DENIED' as const,
};

@Injectable()
export class LgpdService {
  private readonly logger = new Logger(LgpdService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Consentimento ────────────────────────────────────────────────────────

  async registerConsent(
    companyId: string,
    data: {
      subjectType: string;
      subjectId: string;
      document: string;
      purpose: string;
      legalBasis?: string;
      collectedBy?: string;
      expiresAt?: Date;
    },
  ) {
    return this.prisma.consentRecord.create({
      data: {
        companyId,
        subjectType: data.subjectType,
        subjectId: data.subjectId,
        document: data.document,
        purpose: data.purpose as any,
        legalBasis: data.legalBasis,
        collectedBy: data.collectedBy,
        expiresAt: data.expiresAt,
      },
    });
  }

  async revokeConsent(id: string, companyId: string) {
    const record = await this.prisma.consentRecord.findFirst({
      where: { id, companyId },
    });
    if (!record) throw new NotFoundException('Registro de consentimento não encontrado');
    if (record.status !== ConsentStatus.ACTIVE) {
      throw new BadRequestException(`Consentimento já está ${record.status}`);
    }

    return this.prisma.consentRecord.update({
      where: { id },
      data: { status: ConsentStatus.REVOKED, revokedAt: new Date() },
    });
  }

  async listConsents(companyId: string, document?: string) {
    return this.prisma.consentRecord.findMany({
      where: {
        companyId,
        ...(document ? { document } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Portabilidade (Data Subject) ─────────────────────────────────────────

  async getDataSubject(companyId: string, document: string) {
    const [customers, users, suppliers, consents] = await Promise.all([
      this.prisma.customer.findMany({
        where: { companyId, document },
        select: {
          id: true, name: true, document: true, email: true,
          phone: true, address: true, city: true, state: true,
          type: true, isActive: true, createdAt: true,
        },
      }),
      this.prisma.user.findMany({
        where: { companyId, email: document },
        select: {
          id: true, name: true, email: true, role: true,
          isActive: true, createdAt: true,
        },
      }),
      this.prisma.supplier.findMany({
        where: { companyId, cnpj: document },
        select: {
          id: true, name: true, cnpj: true, email: true,
          phone: true, isActive: true, createdAt: true,
        },
      }),
      this.prisma.consentRecord.findMany({
        where: { companyId, document },
        select: {
          id: true, purpose: true, status: true,
          collectedAt: true, revokedAt: true, expiresAt: true, legalBasis: true,
        },
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'LgpdDataSubject',
        action: 'PORTABILITY_REQUEST',
        payload: { document, customersFound: customers.length, usersFound: users.length },
      },
    });

    return {
      document,
      exportedAt: new Date().toISOString(),
      customers,
      users,
      suppliers,
      consents,
    };
  }

  // ─── Anonimização (Direito ao Esquecimento) ──────────────────────────────

  async requestAnonymization(companyId: string, document: string, userId: string) {
    // Verificar se já há requisição pendente
    const existing = await this.prisma.anonymizationRequest.findFirst({
      where: {
        companyId,
        document,
        status: { in: [AnonymizationStatus.REQUESTED, AnonymizationStatus.PROCESSING] },
      },
    });
    if (existing) {
      throw new BadRequestException('Já existe uma requisição de anonimização pendente para este documento');
    }

    // Buscar nome antes de anonimizar
    const customer = await this.prisma.customer.findFirst({
      where: { companyId, document },
    });

    return this.prisma.anonymizationRequest.create({
      data: {
        companyId,
        document,
        subjectName: customer?.name ?? null,
        requestedById: userId,
      },
    });
  }

  async processAnonymization(requestId: string, companyId: string) {
    const request = await this.prisma.anonymizationRequest.findFirst({
      where: { id: requestId, companyId },
    });
    if (!request) throw new NotFoundException('Requisição de anonimização não encontrada');
    if (request.status !== AnonymizationStatus.REQUESTED) {
      throw new BadRequestException(`Requisição já está ${request.status}`);
    }

    await this.prisma.anonymizationRequest.update({
      where: { id: requestId },
      data: { status: AnonymizationStatus.PROCESSING },
    });

    const anonymized = this.generateAnonymousData();
    const affected = { customers: 0, users: 0, suppliers: 0 };

    // Anonimizar Customers
    const customers = await this.prisma.customer.findMany({
      where: { companyId, document: request.document },
    });
    for (const c of customers) {
      await this.prisma.customer.update({
        where: { id: c.id },
        data: {
          name: `ANONIMIZADO_${anonymized.suffix}`,
          email: null,
          phone: null,
          address: null,
          document: `ANON_${anonymized.suffix}`,
        },
      });
      affected.customers++;
    }

    // Anonimizar Users (desativar + mascarar)
    const users = await this.prisma.user.findMany({
      where: { companyId, email: request.document },
    });
    for (const u of users) {
      await this.prisma.user.update({
        where: { id: u.id },
        data: {
          name: `ANONIMIZADO_${anonymized.suffix}`,
          email: `anon_${anonymized.suffix}@removed.lgpd`,
          isActive: false,
        },
      });
      affected.users++;
    }

    // Anonimizar Suppliers
    const suppliers = await this.prisma.supplier.findMany({
      where: { companyId, cnpj: request.document },
    });
    for (const s of suppliers) {
      await this.prisma.supplier.update({
        where: { id: s.id },
        data: {
          name: `ANONIMIZADO_${anonymized.suffix}`,
          email: null,
          phone: null,
          cnpj: `ANON_${anonymized.suffix}`,
        },
      });
      affected.suppliers++;
    }

    // Revogar todos os consentimentos
    await this.prisma.consentRecord.updateMany({
      where: { companyId, document: request.document, status: ConsentStatus.ACTIVE },
      data: { status: ConsentStatus.REVOKED, revokedAt: new Date() },
    });

    // Finalizar requisição
    await this.prisma.anonymizationRequest.update({
      where: { id: requestId },
      data: {
        status: AnonymizationStatus.COMPLETED,
        processedAt: new Date(),
        entitiesAffected: affected,
        subjectName: null, // Apaga nome original
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'AnonymizationRequest',
        action: 'ANONYMIZATION_COMPLETED',
        payload: { requestId, affected },
      },
    });

    this.logger.log(`Anonimização concluída: request=${requestId}, affected=${JSON.stringify(affected)}`);
    return { requestId, affected };
  }

  async listAnonymizationRequests(companyId: string) {
    return this.prisma.anonymizationRequest.findMany({
      where: { companyId },
      include: { requestedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private generateAnonymousData() {
    const suffix = randomBytes(6).toString('hex');
    return { suffix };
  }
}
