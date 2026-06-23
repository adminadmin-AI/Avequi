import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/filters/business-exception.filter';
import { CnabLayoutFactory } from './cnab-layout.factory';
import { CnabBoleto } from './layouts/cnab240-base';
import { BoletoStatus, CnabRemessaStatus, CnabRetornoStatus } from '../../../generated/prisma';

@Injectable()
export class CnabService {
  private readonly logger = new Logger(CnabService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Remessa ──────────────────────────────────────────────────────────────

  async generateRemessa(
    companyId: string,
    bankAccountId: string,
    boletoIds: string[],
  ) {
    // Load bank account
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId },
    });
    if (!bankAccount) {
      throw new BusinessException('Conta bancária não encontrada', HttpStatus.NOT_FOUND);
    }
    if (!bankAccount.bankCode) {
      throw new BusinessException(
        'Conta bancária sem código de banco definido',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Load boletos
    const boletos = await this.prisma.boleto.findMany({
      where: {
        id: { in: boletoIds },
        companyId,
        bankAccountId,
        status: { in: [BoletoStatus.PENDING, BoletoStatus.REGISTERED] },
      },
      include: { bankAccount: true },
    }) as unknown as CnabBoleto[];

    if (boletos.length === 0) {
      throw new BusinessException(
        'Nenhum boleto válido encontrado para gerar remessa',
      );
    }
    if (boletos.length !== boletoIds.length) {
      this.logger.warn(
        `Remessa solicitada para ${boletoIds.length} boletos, mas apenas ${boletos.length} foram encontrados/válidos`,
      );
    }

    // Load company info
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { cnpj: true, name: true },
    });
    if (!company) {
      throw new BusinessException('Empresa não encontrada', HttpStatus.NOT_FOUND);
    }

    // Get next sequence number
    const lastRemessa = await this.prisma.cnabRemessa.findFirst({
      where: { companyId, bankAccountId },
      orderBy: { sequenceNumber: 'desc' },
    });
    const sequenceNumber = (lastRemessa?.sequenceNumber ?? 0) + 1;

    // Select the correct layout
    const layout = CnabLayoutFactory.create(bankAccount.bankCode);

    // Generate file content
    const fileContent = layout.generateRemessaFile(
      { cnpj: company.cnpj, name: company.name },
      {
        id: bankAccount.id,
        name: bankAccount.name,
        bankCode: bankAccount.bankCode,
        agency: bankAccount.agency,
        accountNumber: bankAccount.accountNumber,
      },
      boletos,
      sequenceNumber,
    );

    const totalAmount = boletos.reduce((s, b) => s + Number(b.amount), 0);
    const fileName = `${bankAccount.bankCode}_${companyId.substring(0, 8)}_${sequenceNumber.toString().padStart(6, '0')}.rem`;

    // Persist to database
    const remessa = await this.prisma.cnabRemessa.create({
      data: {
        companyId,
        bankAccountId,
        fileName,
        sequenceNumber,
        totalBoletos: boletos.length,
        totalAmount,
        status: CnabRemessaStatus.GENERATED,
        fileContent,
        generatedAt: new Date(),
        items: {
          create: boletos.flatMap((boleto, idx) => {
            const base = idx * 3;
            const lines = fileContent.split('\n');
            // header arquivo + header lote = 2 lines before segments
            const segOffset = 2 + base;
            return [
              { boletoId: boleto.id, segmento: 'P', lineNumber: segOffset + 1, lineContent: lines[segOffset] ?? '' },
              { boletoId: boleto.id, segmento: 'Q', lineNumber: segOffset + 2, lineContent: lines[segOffset + 1] ?? '' },
              { boletoId: boleto.id, segmento: 'R', lineNumber: segOffset + 3, lineContent: lines[segOffset + 2] ?? '' },
            ];
          }),
        },
      },
      include: { items: true },
    });

    return { remessa, fileContent };
  }

  async findAllRemessas(companyId: string) {
    return this.prisma.cnabRemessa.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        bankAccount: { select: { id: true, name: true, bankCode: true } },
        _count: { select: { items: true } },
      },
    });
  }

  // ─── Retorno ──────────────────────────────────────────────────────────────

  async processRetorno(
    companyId: string,
    bankAccountId: string,
    fileName: string,
    fileContent: string,
  ) {
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId },
    });
    if (!bankAccount) {
      throw new BusinessException('Conta bancária não encontrada', HttpStatus.NOT_FOUND);
    }
    if (!bankAccount.bankCode) {
      throw new BusinessException('Conta bancária sem código de banco definido', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const layout = CnabLayoutFactory.create(bankAccount.bankCode);

    // Create retorno record
    const retorno = await this.prisma.cnabRetorno.create({
      data: {
        companyId,
        bankAccountId,
        fileName,
        status: CnabRetornoStatus.PROCESSING,
      },
    });

    try {
      const lines = fileContent.split(/\r?\n/).filter(l => l.length >= 240);
      const parsedItems = lines
        .map(line => layout.parseRetornoLine(line))
        .filter((item): item is NonNullable<typeof item> => item !== null);

      let matchedCount = 0;
      let unmatchedCount = 0;
      let totalPaidAmount = 0;

      const retornoItems = await Promise.all(
        parsedItems.map(async item => {
          // Find boleto by nossoNumero
          const boleto = await this.prisma.boleto.findFirst({
            where: { bankAccountId, nossoNumero: item.nossoNumero, companyId },
          });

          const matched = !!boleto;

          // Update boleto status based on occurrence
          if (boleto) {
            matchedCount++;
            const paidOccurrences = ['06', '07', '17'];
            const cancelledOccurrences = ['09', '10', '25'];

            if (paidOccurrences.includes(item.occurrence)) {
              await this.prisma.boleto.update({
                where: { id: boleto.id },
                data: {
                  status: BoletoStatus.PAID,
                  paidAt: item.paidAt ?? new Date(),
                  paidAmount: item.paidAmount,
                },
              });
              totalPaidAmount += item.paidAmount;
            } else if (cancelledOccurrences.includes(item.occurrence)) {
              await this.prisma.boleto.update({
                where: { id: boleto.id },
                data: {
                  status: BoletoStatus.CANCELLED,
                  cancelledAt: new Date(),
                },
              });
            } else if (item.occurrence === '02') {
              await this.prisma.boleto.update({
                where: { id: boleto.id },
                data: { status: BoletoStatus.REGISTERED, registeredAt: new Date() },
              });
            }
          } else {
            unmatchedCount++;
          }

          return {
            retornoId: retorno.id,
            boletoId: boleto?.id ?? null,
            nossoNumero: item.nossoNumero,
            occurrence: item.occurrence,
            occurrenceDesc: item.occurrenceDesc,
            amount: item.amount || null,
            paidAmount: item.paidAmount || null,
            paidAt: item.paidAt,
            matched,
          };
        }),
      );

      // Create all retorno items
      await this.prisma.cnabRetornoItem.createMany({ data: retornoItems });

      // Update retorno with final status
      const updatedRetorno = await this.prisma.cnabRetorno.update({
        where: { id: retorno.id },
        data: {
          status: CnabRetornoStatus.PROCESSED,
          processedAt: new Date(),
          matchedCount,
          unmatchedCount,
          totalAmount: totalPaidAmount,
        },
        include: { items: true, bankAccount: { select: { id: true, name: true } } },
      });

      return updatedRetorno;
    } catch (error) {
      await this.prisma.cnabRetorno.update({
        where: { id: retorno.id },
        data: {
          status: CnabRetornoStatus.ERROR,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async findAllRetornos(companyId: string) {
    return this.prisma.cnabRetorno.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        bankAccount: { select: { id: true, name: true, bankCode: true } },
        _count: { select: { items: true } },
      },
    });
  }

  async findOneRetorno(companyId: string, id: string) {
    const retorno = await this.prisma.cnabRetorno.findFirst({
      where: { id, companyId },
      include: {
        bankAccount: true,
        items: {
          include: {
            boleto: { select: { id: true, nossoNumero: true, payerName: true, amount: true } },
          },
        },
      },
    });
    if (!retorno) {
      throw new BusinessException('Retorno CNAB não encontrado', HttpStatus.NOT_FOUND);
    }
    return retorno;
  }
}
