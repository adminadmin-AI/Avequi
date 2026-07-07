import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Resolução de loja pros conectores públicos (F1.4-F1.6). O formulário/anúncio
 * manda um slug de cidade ("cascavel", "guarapuava", "matriz"); casamos por
 * nome de company. Sem match ou sem slug → null (lead cai na triagem da matriz,
 * comportamento do LeadIntakeService).
 */
@Injectable()
export class StoreResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(slug?: string | null): Promise<string | null> {
    const clean = slug?.trim();
    if (!clean) return null;
    const company = await this.prisma.company.findFirst({
      where: { name: { contains: clean, mode: 'insensitive' } },
      select: { id: true },
    });
    return company?.id ?? null;
  }
}
