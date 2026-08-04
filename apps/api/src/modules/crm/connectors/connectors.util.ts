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

  /**
   * Company raiz do tenant dono dos conectores públicos — fail-closed.
   *
   * Multi-site (#962): um `site` explícito ("avecchi") resolve pela env
   * indexada `CRM_CONNECTOR_TENANT_ID__<SITE>` (mesmo padrão das envs
   * FOCUS_NFE_TOKEN__*). Sem `site` vale a env default — o formulário da GDR
   * segue funcionando sem mudança. Site desconhecido = 503, NUNCA cai no
   * default: silêncio aqui mandaria lead de um site pro tenant de outro.
   */
  tenantRootId(site?: string | null): string {
    const clean = site?.trim().toLowerCase();
    const envKey = clean
      ? `CRM_CONNECTOR_TENANT_ID__${clean.toUpperCase().replace(/-/g, '_')}`
      : 'CRM_CONNECTOR_TENANT_ID';
    const id = process.env[envKey]?.trim();
    if (!id) {
      throw new ServiceUnavailableException(
        `Conector de leads indisponível: a env ${envKey} não está configurada no servidor.`,
      );
    }
    return id;
  }

  async resolve(slug?: string | null, rootId?: string): Promise<string | null> {
    const clean = slug?.trim();
    if (!clean) return null;
    const root = rootId ?? this.tenantRootId();
    const company = await this.prisma.company.findFirst({
      where: {
        name: { contains: clean, mode: 'insensitive' },
        // árvore do tenant dono dos conectores: matriz ou filial direta
        OR: [{ id: root }, { parentId: root }],
      },
      select: { id: true },
    });
    return company?.id ?? null;
  }
}
