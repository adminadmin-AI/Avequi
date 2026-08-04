import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Resolução de loja pros conectores públicos (F1.4-F1.6). O formulário/anúncio
 * manda um slug de cidade ("cascavel", "guarapuava", "matriz"); casamos por
 * nome de company. Sem match ou sem slug → null (lead cai na triagem da matriz,
 * comportamento do LeadIntakeService).
 *
 * Tenancy (#962/#984): os conectores públicos pertencem a UM tenant — o dono
 * do site/anúncios, definido pela env CRM_CONNECTOR_TENANT_ID (id da company
 * RAIZ). O casamento por nome acontece só dentro da árvore matriz+filiais
 * desse tenant; sem a env o conector fica indisponível (fail-closed) em vez
 * de casar nomes no banco inteiro e rotear lead pra tenant alheio.
 */
@Injectable()
export class StoreResolver {
  constructor(private readonly prisma: PrismaService) {}

  /** Company raiz do tenant dono dos conectores públicos — fail-closed. */
  tenantRootId(): string {
    const id = process.env.CRM_CONNECTOR_TENANT_ID?.trim();
    if (!id) {
      throw new ServiceUnavailableException(
        'Conector de leads indisponível: a env CRM_CONNECTOR_TENANT_ID não está configurada no servidor.',
      );
    }
    return id;
  }

  async resolve(slug?: string | null): Promise<string | null> {
    const clean = slug?.trim();
    if (!clean) return null;
    const rootId = this.tenantRootId();
    const company = await this.prisma.company.findFirst({
      where: {
        name: { contains: clean, mode: 'insensitive' },
        // árvore do tenant dono dos conectores: matriz ou filial direta
        OR: [{ id: rootId }, { parentId: rootId }],
      },
      select: { id: true },
    });
    return company?.id ?? null;
  }
}
