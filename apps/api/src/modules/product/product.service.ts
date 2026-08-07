import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { clampTake, paginate, type PaginatedResult } from '../../common/pagination/paginate.util';
import { createCsvCursorStream, type CsvColumn } from '../../common/csv-export/csv-cursor-stream';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { ProductOptionsQueryDto } from './dto/product-options-query.dto';

/**
 * Campos que a TELA DE LISTA usa (apps/web/src/app/app/products/page.tsx) —
 * #1028. `minStock` entrou depois (parte 2): o monitor de reposição
 * (`purchases/automation`) também lê `/products` (paginado, várias páginas)
 * e precisava do campo — sem ele a classificação OK/ALERTA/CRÍTICO ficava
 * sempre "sem mínimo definido" silenciosamente.
 */
const PRODUCT_LIST_SELECT = {
  id: true,
  sku: true,
  name: true,
  type: true,
  unit: true,
  ncm: true,
  costPrice: true,
  salePrice: true,
  isActive: true,
  minStock: true,
} satisfies Prisma.ProductSelect;

export type ProductListItem = Prisma.ProductGetPayload<{ select: typeof PRODUCT_LIST_SELECT }>;

/**
 * Payload do combobox de formulário (#1028 parte 2) — os ~21 consumidores de
 * `/products` que esperam array puro (selects de venda, produção, compra
 * etc.). Começou só `{id, sku, name}` (rótulo do combobox); levantamento no
 * apps/web mostrou 3 consumidores que precisam de mais, todos para PRÉ-
 * PREENCHER o item ao adicionar (não dá pra buscar de novo depois — o
 * catálogo completo não existe mais no cliente):
 *  - `salePrice` — preço unitário default em venda/orçamento novo
 *  - `costPrice`/`avgCost` — custo de referência default em pedido de compra
 *  - `tracksSerial` — balcão trava quantidade e exige scan de chassi
 * Ainda assim MUITO mais enxuto que o Product inteiro (sem descrição, NCM,
 * pesos, dados fiscais etc. — nenhum consumidor de combobox usa isso).
 */
const PRODUCT_OPTIONS_SELECT = {
  id: true,
  sku: true,
  name: true,
  salePrice: true,
  costPrice: true,
  avgCost: true,
  tracksSerial: true,
} satisfies Prisma.ProductSelect;

export type ProductOption = Prisma.ProductGetPayload<{ select: typeof PRODUCT_OPTIONS_SELECT }>;

/** Colunas do CSV de export (#1032) — mesmo conjunto de PRODUCT_LIST_SELECT,
 *  na ordem que a tela de lista exibe. */
const PRODUCT_EXPORT_COLUMNS: CsvColumn<ProductListItem>[] = [
  { header: 'SKU', value: (p) => p.sku },
  { header: 'Nome', value: (p) => p.name },
  { header: 'Tipo', value: (p) => p.type },
  { header: 'Unidade', value: (p) => p.unit },
  { header: 'NCM', value: (p) => p.ncm },
  { header: 'Preço de custo', value: (p) => p.costPrice },
  { header: 'Preço de venda', value: (p) => p.salePrice },
  { header: 'Estoque mínimo', value: (p) => p.minStock },
  { header: 'Ativo', value: (p) => (p.isActive ? 'Sim' : 'Não') },
];

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto, user: { id?: string; companyId: string }) {
    // companyId SEMPRE vem do JWT do usuário autenticado (nunca do body)
    const companyId = user.companyId;

    // Validate NCM rule
    if (dto.type === 'FINISHED_GOOD' && !dto.ncm) {
      throw new BadRequestException('Produto acabado exige NCM');
    }

    // Check SKU uniqueness per company
    const existing = await this.prisma.product.findUnique({
      where: { companyId_sku: { companyId, sku: dto.sku } },
    });
    if (existing) {
      throw new ConflictException(`SKU '${dto.sku}' já existe para esta empresa`);
    }

    const product = await this.prisma.product.create({
      data: { ...dto, companyId },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'Product',
        action: 'CREATE',
        payload: { ...dto },
      },
    });

    return product;
  }

  /**
   * `where` compartilhado entre `findAll` (paginado) e `exportCsv` (cursor) —
   * #1032: o export precisa receber EXATAMENTE os mesmos filtros da
   * listagem, então os dois caminhos passam pela mesma montagem de filtro
   * em vez de duplicar a lógica (risco de divergir com o tempo).
   */
  private buildWhere(
    companyId: string,
    query: Pick<ProductQueryDto, 'type' | 'isActive' | 'search'>,
  ): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { companyId };

    if (query.type) {
      where.type = query.type;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  async findAll(
    companyId: string,
    query: ProductQueryDto,
  ): Promise<PaginatedResult<ProductListItem>> {
    const where = this.buildWhere(companyId, query);

    return paginate({
      orderBy: { createdAt: 'desc' as const },
      page: query.page,
      pageSize: query.pageSize,
      count: () => this.prisma.product.count({ where }),
      findMany: (args) =>
        this.prisma.product.findMany({ where, select: PRODUCT_LIST_SELECT, ...args }),
    });
  }

  /**
   * GET /products/export (#1032) — CSV com os MESMOS filtros de `findAll`,
   * conjunto completo (não só a página). Cursor + streaming em lote: nunca
   * carrega o conjunto inteiro em memória (ver csv-cursor-stream.ts) — o
   * `findMany` abaixo usa `cursor`/`take` como chaves de primeiro nível de
   * propósito (list-query-lint exige isso pra aprovar a chamada).
   */
  exportCsv(companyId: string, query: ProductQueryDto): Readable {
    const where = this.buildWhere(companyId, query);

    return createCsvCursorStream<ProductListItem>(
      PRODUCT_EXPORT_COLUMNS,
      async (cursor, batchSize) => {
        const items = await this.prisma.product.findMany({
          where,
          select: PRODUCT_LIST_SELECT,
          orderBy: { id: 'asc' },
          take: batchSize,
          cursor: cursor ? { id: cursor } : undefined,
          skip: cursor ? 1 : 0,
        });
        return { items, nextCursor: items[items.length - 1]?.id };
      },
    );
  }

  /**
   * GET /products/options (#1028 parte 2) — combobox de formulário. Sem
   * paginação (lote único, teto de `take`), payload mínimo, ordenação
   * estável por nome. Mesma permissão de `findAll` (products.catalog.view).
   */
  async findOptions(companyId: string, query: ProductOptionsQueryDto): Promise<ProductOption[]> {
    const where: Prisma.ProductWhereInput = { companyId };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.product.findMany({
      where,
      select: PRODUCT_OPTIONS_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: clampTake(query.take),
    });
  }

  async findOne(id: string, companyId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId },
    });
    if (!product) throw new NotFoundException(`Produto ${id} não encontrado`);
    return product;
  }

  async update(id: string, dto: UpdateProductDto, user: { id?: string; companyId: string }) {
    // Busca escopada pela empresa do usuário — impede editar produto de outro tenant
    const existing = await this.prisma.product.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!existing) throw new NotFoundException(`Produto ${id} não encontrado`);

    // companyId é imutável: registro nunca muda de empresa via update
    const companyId = existing.companyId;

    // Validate SKU uniqueness if changed
    if (dto.sku && dto.sku !== existing.sku) {
      const duplicate = await this.prisma.product.findUnique({
        where: { companyId_sku: { companyId, sku: dto.sku } },
      });
      if (duplicate) {
        throw new ConflictException(`SKU '${dto.sku}' já existe para esta empresa`);
      }
    }

    // Validate NCM rule
    const effectiveType = dto.type || existing.type;
    const effectiveNcm = dto.ncm !== undefined ? dto.ncm : existing.ncm;
    if (effectiveType === 'FINISHED_GOOD' && !effectiveNcm) {
      throw new BadRequestException('Produto acabado exige NCM');
    }

    // Defesa em profundidade: descarta qualquer companyId injetado no payload
    const { companyId: _ignored, ...data } = dto as any;

    const product = await this.prisma.product.update({
      where: { id },
      data,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'Product',
        action: 'UPDATE',
        payload: { ...dto },
      },
    });

    return product;
  }
}
