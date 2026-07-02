import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CCLASSTRIB_TABLE } from './data/cclasstrib.data';

/** CSTs de isenção/imunidade — derivam isExempt */
const EXEMPT_CSTS = ['400', '410'];
/** CSTs de redução de alíquota ou base — derivam isReduced */
const REDUCED_CSTS = ['011', '200', '222', '515'];

@Injectable()
export class TributaryClassificationService {
  private readonly logger = new Logger(TributaryClassificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters?: { cst?: string; nfeOnly?: boolean; search?: string }) {
    return this.prisma.tributaryClassification.findMany({
      where: {
        ...(filters?.cst && { cst: filters.cst }),
        ...(filters?.nfeOnly && { allowsNfe: true }),
        ...(filters?.search && {
          description: { contains: filters.search, mode: 'insensitive' },
        }),
        OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
      },
      orderBy: { code: 'asc' },
    });
  }

  async findByCode(code: string) {
    const item = await this.prisma.tributaryClassification.findUnique({ where: { code } });
    if (!item) throw new NotFoundException(`Classificação tributária ${code} não encontrada`);
    return item;
  }

  /**
   * Sincroniza a tabela local com data/cclasstrib.data.ts (upsert por code).
   * A tabela oficial muda com frequência: reextrair do Portal DF-e SVRS,
   * regenerar o arquivo de dados e chamar este método (ou rodar o seed).
   */
  async syncFromOfficialTable(): Promise<{ total: number; created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const entry of CCLASSTRIB_TABLE) {
      const data = {
        description: entry.description,
        cst: entry.cst,
        percRedIbs: entry.percRedIbs,
        percRedCbs: entry.percRedCbs,
        isExempt: EXEMPT_CSTS.includes(entry.cst),
        isReduced: REDUCED_CSTS.includes(entry.cst) || entry.percRedIbs > 0 || entry.percRedCbs > 0,
        isMonophase: entry.isMonophase,
        allowsCredPres: entry.allowsCredPres,
        allowsNfe: entry.allowsNfe,
        validFrom: entry.validFrom ? new Date(entry.validFrom) : null,
        validTo: entry.validTo ? new Date(entry.validTo) : null,
      };

      const existing = await this.prisma.tributaryClassification.findUnique({
        where: { code: entry.code },
      });
      if (existing) {
        await this.prisma.tributaryClassification.update({ where: { code: entry.code }, data });
        updated++;
      } else {
        await this.prisma.tributaryClassification.create({ data: { code: entry.code, ...data } });
        created++;
      }
    }

    this.logger.log(`cClassTrib sync: ${created} criados, ${updated} atualizados (${CCLASSTRIB_TABLE.length} total)`);
    return { total: CCLASSTRIB_TABLE.length, created, updated };
  }

  /** Valida se um código existe, está vigente e é aplicável a NF-e */
  async validateForNfe(code: string): Promise<boolean> {
    const item = await this.prisma.tributaryClassification.findUnique({ where: { code } });
    if (!item || !item.allowsNfe) return false;
    const now = new Date();
    if (item.validFrom && item.validFrom > now) return false;
    if (item.validTo && item.validTo < now) return false;
    return true;
  }
}
