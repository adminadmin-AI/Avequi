import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, type PaginatedResult } from '../../common/pagination/paginate.util';
import { CreateMovementDto } from './dto/create-movement.dto';
import { ReplenishmentQueryDto, ReplenishmentStatus } from './dto/replenishment-query.dto';

const OUTBOUND_TYPES: MovementType[] = [MovementType.EXIT, MovementType.TRANSFER_OUT];

/** Item do monitor de reposição (#1031) — join produto × saldo somado por
 *  depósito, já classificado no servidor. */
export interface ReplenishmentItem {
  productId: string;
  sku: string;
  name: string;
  type: string;
  minStock: number;
  available: number;
  /** available - minStock. Negativo = déficit (abaixo do mínimo). Critério
   *  de ordenação por criticidade: quanto mais negativo, mais urgente. */
  gap: number;
  status: ReplenishmentStatus;
}

interface ReplenishmentRow {
  productId: string;
  sku: string;
  name: string;
  type: string;
  minStock: number;
  available: number;
}

/** Folga acima do mínimo que ainda conta como "em risco" — a issue #1031 não
 *  define o limiar; 20% é a margem de segurança adotada aqui (documentado no
 *  relatório de entrega). Ajustável sem quebrar contrato caso o negócio
 *  calibre diferente depois. */
const RISK_MARGIN = 0.2;

/**
 * Fragmento HAVING que implementa a classificação de status — pós-agregação,
 * porque `available` só existe depois do SUM(sb.available) agrupado por
 * produto. Ver `ReplenishmentStatus` (dto) para a definição de cada status,
 * incluindo os casos de borda (igual ao mínimo, minStock=0/indefinido).
 *
 * Sem filtro de status: retorna o que precisa de atenção (BELOW_MIN ∪
 * AT_RISK) — é o comportamento "monitor de reposição" da issue; OK só entra
 * quando pedido explicitamente via `status=OK`.
 */
export function statusHavingClause(status?: ReplenishmentStatus): Prisma.Sql {
  const belowMin = Prisma.sql`(p."minStock" > 0 AND COALESCE(SUM(sb.available), 0) < p."minStock")`;
  const atRisk = Prisma.sql`(p."minStock" > 0 AND COALESCE(SUM(sb.available), 0) >= p."minStock" AND COALESCE(SUM(sb.available), 0) < p."minStock" * ${1 + RISK_MARGIN})`;
  const ok = Prisma.sql`(p."minStock" <= 0 OR COALESCE(SUM(sb.available), 0) >= p."minStock" * ${1 + RISK_MARGIN})`;

  switch (status) {
    case ReplenishmentStatus.BELOW_MIN:
      return belowMin;
    case ReplenishmentStatus.AT_RISK:
      return atRisk;
    case ReplenishmentStatus.OK:
      return ok;
    default:
      return Prisma.sql`(${belowMin} OR ${atRisk})`;
  }
}

/**
 * Classificação de status em JS — usada para montar `ReplenishmentItem.status`
 * a partir das linhas que a query já filtrou via `statusHavingClause`.
 * EXPORTADA para spec direto dos limites (#1031, critério de aceite):
 *  - `available === minStock` (igual ao mínimo) → AT_RISK, não BELOW_MIN nem
 *    OK: está na borda, folga zero, mas tecnicamente não abaixo do mínimo.
 *  - `minStock === 0` (zero, ou "sem mínimo definido" — o schema não tem
 *    NULL, o default É zero) → sempre OK, não importa `available`: sem
 *    política de reposição não há o que classificar.
 *  - `available === 0` com `minStock > 0` (produto sem saldo em nenhum
 *    depósito, ou LEFT JOIN sem nenhuma linha de StockBalance) → BELOW_MIN.
 */
export function classifyReplenishment(minStock: number, available: number): ReplenishmentStatus {
  if (minStock <= 0) return ReplenishmentStatus.OK;
  if (available < minStock) return ReplenishmentStatus.BELOW_MIN;
  if (available < minStock * (1 + RISK_MARGIN)) return ReplenishmentStatus.AT_RISK;
  return ReplenishmentStatus.OK;
}

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalances(companyId: string, warehouseId?: string, productId?: string) {
    const where: any = { companyId };
    if (warehouseId) where.warehouseId = warehouseId;
    if (productId) where.productId = productId;

    return this.prisma.stockBalance.findMany({
      where,
      include: {
        product: true,
        warehouse: true,
      },
      orderBy: [
        { warehouse: { code: 'asc' } },
        { product: { sku: 'asc' } },
      ],
    });
  }

  async getBalance(warehouseId: string, productId: string, companyId: string) {
    return this.prisma.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId, productId } },
      include: {
        product: true,
        warehouse: true,
      },
    });
  }

  async move(dto: CreateMovementDto & { companyId: string }, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      // Find or create balance
      let balance = await tx.stockBalance.findUnique({
        where: { warehouseId_productId: { warehouseId: dto.warehouseId, productId: dto.productId } },
      });

      if (!balance) {
        balance = await tx.stockBalance.create({
          data: {
            companyId: dto.companyId,
            warehouseId: dto.warehouseId,
            productId: dto.productId,
            available: 0,
            reserved: 0,
          },
        });
      }

      // SELECT FOR UPDATE — row-level lock to prevent race conditions (#219)
      const [locked] = await tx.$queryRawUnsafe<{ available: any }[]>(
        `SELECT "available" FROM "gdr_stock_balances" WHERE "warehouseId" = $1 AND "productId" = $2 FOR UPDATE`,
        dto.warehouseId,
        dto.productId,
      );

      // Check sufficient stock for outbound (using locked row value)
      if (OUTBOUND_TYPES.includes(dto.type)) {
        const available = Number(locked?.available ?? balance.available);
        if (available < dto.quantity) {
          throw new BadRequestException(
            `Saldo insuficiente. Disponível: ${available}, solicitado: ${dto.quantity}`,
          );
        }
      }

      // Calculate delta
      const isOutbound = OUTBOUND_TYPES.includes(dto.type);
      const delta = isOutbound ? -dto.quantity : dto.quantity;

      // Update balance
      await tx.stockBalance.update({
        where: { warehouseId_productId: { warehouseId: dto.warehouseId, productId: dto.productId } },
        data: { available: { increment: delta } },
      });

      // Create movement (append-only)
      const movement = await tx.stockMovement.create({
        data: {
          companyId: dto.companyId,
          warehouseId: dto.warehouseId,
          productId: dto.productId,
          type: dto.type,
          quantity: dto.quantity,
          reason: dto.reason,
          reference: dto.reference,
          userId,
        },
      });

      // AuditLog
      await tx.auditLog.create({
        data: {
          userId,
          companyId: dto.companyId,
          entity: 'StockMovement',
          action: 'CREATE',
          payload: { movementId: movement.id, type: dto.type, quantity: dto.quantity },
        },
      });

      return movement;
    });
  }

  async reverse(movementId: string, reason: string, userId: string | undefined, companyId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Find original movement scoped to companyId
      const original = await tx.stockMovement.findFirst({
        where: { id: movementId, companyId },
      });

      if (!original) {
        throw new NotFoundException(`Movimento ${movementId} não encontrado`);
      }

      if (original.type === MovementType.REVERSAL) {
        throw new BadRequestException('Não é possível estornar um estorno');
      }

      if (original.reversedById) {
        throw new ConflictException('Este movimento já foi estornado');
      }

      // Calculate reverse delta (opposite of original)
      const isOutbound = OUTBOUND_TYPES.includes(original.type);
      // Reversal undoes original: if original was outbound (negative), reversal adds back (positive)
      const reverseDelta = isOutbound ? Number(original.quantity) : -Number(original.quantity);

      // If removing stock (negative delta), check balance with row lock
      if (reverseDelta < 0) {
        const [locked] = await tx.$queryRawUnsafe<{ available: any }[]>(
          `SELECT "available" FROM "gdr_stock_balances" WHERE "warehouseId" = $1 AND "productId" = $2 FOR UPDATE`,
          original.warehouseId,
          original.productId,
        );
        const available = locked ? Number(locked.available) : 0;
        const removeQty = Math.abs(reverseDelta);
        if (available < removeQty) {
          throw new BadRequestException(
            `Saldo insuficiente para estorno. Disponível: ${available}, solicitado: ${removeQty}`,
          );
        }
      }

      // Create REVERSAL movement
      const reversal = await tx.stockMovement.create({
        data: {
          companyId: original.companyId,
          warehouseId: original.warehouseId,
          productId: original.productId,
          type: MovementType.REVERSAL,
          quantity: original.quantity,
          reason,
          reference: `REVERSAL:${original.id}`,
          userId,
        },
      });

      // Update balance
      await tx.stockBalance.update({
        where: { warehouseId_productId: { warehouseId: original.warehouseId, productId: original.productId } },
        data: { available: { increment: reverseDelta } },
      });

      // Mark original as reversed (the ONE allowed update)
      await tx.stockMovement.update({
        where: { id: original.id },
        data: { reversedById: reversal.id },
      });

      // AuditLog
      await tx.auditLog.create({
        data: {
          userId,
          companyId: original.companyId,
          entity: 'StockMovement',
          action: 'REVERSAL',
          payload: { originalId: original.id, reversalId: reversal.id, reason },
        },
      });

      return reversal;
    });
  }

  // ─── #230: Facade methods for cross-module use ───────────────────────────

  /**
   * Reserve stock for a sales order or other document.
   * Decrements `available`, increments `reserved`.
   */
  async reserveBalance(
    warehouseId: string,
    productId: string,
    quantity: number,
    companyId: string,
    tx?: any,
  ) {
    const prisma = tx ?? this.prisma;
    await prisma.stockBalance.update({
      where: { warehouseId_productId: { warehouseId, productId } },
      data: {
        available: { decrement: quantity },
        reserved: { increment: quantity },
      },
    });
  }

  /**
   * Release previously reserved stock (e.g., order cancelled).
   * Decrements `reserved`, increments `available`.
   */
  async releaseBalance(
    warehouseId: string,
    productId: string,
    quantity: number,
    tx?: any,
  ) {
    const prisma = tx ?? this.prisma;
    // tenant-lint: ok (operação interna de estoque: warehouse/product já escopados pelo chamador tenant-aware)
    await prisma.stockBalance.update({
      where: { warehouseId_productId: { warehouseId, productId } },
      data: {
        reserved: { decrement: quantity },
        available: { increment: quantity },
      },
    });
  }

  /**
   * Consume reserved stock (invoice): decrements `reserved`, creates EXIT movement.
   */
  async consumeReserved(
    warehouseId: string,
    productId: string,
    quantity: number,
    companyId: string,
    reason: string,
    userId?: string,
    tx?: any,
  ) {
    const prisma = tx ?? this.prisma;
    await prisma.stockBalance.update({
      where: { warehouseId_productId: { warehouseId, productId } },
      data: { reserved: { decrement: quantity } },
    });
    await prisma.stockMovement.create({
      data: {
        companyId,
        warehouseId,
        productId,
        type: 'EXIT',
        quantity,
        reason,
        userId,
      },
    });
  }

  /**
   * Return stock: increments `available`, creates ENTRY movement.
   */
  async returnStock(
    warehouseId: string,
    productId: string,
    quantity: number,
    companyId: string,
    reason: string,
    userId?: string,
    tx?: any,
  ) {
    const prisma = tx ?? this.prisma;
    await prisma.stockBalance.update({
      where: { warehouseId_productId: { warehouseId, productId } },
      data: { available: { increment: quantity } },
    });
    await prisma.stockMovement.create({
      data: {
        companyId,
        warehouseId,
        productId,
        type: 'ENTRY',
        quantity,
        reason,
        userId,
      },
    });
  }

  /**
   * Receive goods: increments `available`, creates ENTRY movement, returns movement.
   */
  async receiveGoods(
    warehouseId: string,
    productId: string,
    quantity: number,
    companyId: string,
    reason: string,
    userId?: string,
    tx?: any,
  ) {
    const prisma = tx ?? this.prisma;
    // Ensure balance exists
    await prisma.stockBalance.upsert({
      where: { warehouseId_productId: { warehouseId, productId } },
      create: { companyId, warehouseId, productId, available: quantity, reserved: 0 },
      update: { available: { increment: quantity } },
    });
    return prisma.stockMovement.create({
      data: {
        companyId,
        warehouseId,
        productId,
        type: 'ENTRY',
        quantity,
        reason,
        userId,
      },
    });
  }

  async getMovements(companyId: string, warehouseId?: string, productId?: string) {
    const where: any = { companyId };
    if (warehouseId) where.warehouseId = warehouseId;
    if (productId) where.productId = productId;

    return this.prisma.stockMovement.findMany({
      where,
      take: 100,
      include: {
        product: true,
        warehouse: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * GET /stock/replenishment (#1031) — monitor de reposição com join no
   * SERVIDOR: produto × saldo somado por depósito, já classificado e
   * ordenado por criticidade. Substitui o padrão anterior da tela
   * `purchases/automation` (baixar catálogo inteiro em loop + `/stock/
   * balances` sem teto + cruzar em memória).
   *
   * Precisa de SQL bruto (`$queryRaw`) porque o filtro por status compara um
   * agregado (SUM(sb.available) por produto) contra uma coluna de OUTRA
   * tabela (Product.minStock) — Prisma `groupBy`/`having` só compara
   * agregados contra literais, não contra uma coluna do lado "one" do join.
   * Precedente no repo: `analytics.service.ts` (`salesCube`,
   * `inventoryAging`) já usa `Prisma.sql` para o mesmo tipo de relatório.
   *
   * Paginação: usa o `paginate()` canônico (#1028) para clamp de page/
   * pageSize (teto 100) e o envelope `{items,total,page,pageSize}`. O
   * `orderBy` typed do Prisma não se aplica aqui (a ordenação por
   * criticidade é `ORDER BY gap ASC` — expressão calculada, não uma coluna) —
   * a query já sai com `p.id ASC` como desempate estável, equivalente ao que
   * `withStableTiebreak` faria.
   */
  async getReplenishment(
    companyId: string,
    query: ReplenishmentQueryDto,
  ): Promise<PaginatedResult<ReplenishmentItem>> {
    const warehouseFilter = query.warehouseId
      ? Prisma.sql`AND sb."warehouseId" = ${query.warehouseId}`
      : Prisma.empty;
    const typeFilter = query.type
      ? Prisma.sql`AND p."type" = ${query.type}::"ProductType"`
      : Prisma.empty;
    const having = statusHavingClause(query.status);

    // Compartilhado entre count e listagem — FROM/JOIN/WHERE/GROUP BY/HAVING
    // idênticos, só muda o que a query externa faz com as linhas agregadas.
    const aggregated = Prisma.sql`
      FROM gdr_products p
      LEFT JOIN gdr_stock_balances sb
        ON sb."productId" = p.id AND sb."companyId" = p."companyId" ${warehouseFilter}
      WHERE p."companyId" = ${companyId}
        AND p."isActive" = true
        ${typeFilter}
      GROUP BY p.id, p.sku, p.name, p."type", p."minStock"
      HAVING ${having}
    `;

    return paginate<ReplenishmentItem, Record<string, never>>({
      orderBy: {},
      page: query.page,
      pageSize: query.pageSize,
      count: async () => {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
          SELECT COUNT(*)::bigint AS count FROM (SELECT p.id ${aggregated}) sub
        `);
        return Number(rows[0]?.count ?? 0);
      },
      findMany: async ({ skip, take }) => {
        const rows = await this.prisma.$queryRaw<ReplenishmentRow[]>(Prisma.sql`
          SELECT
            p.id AS "productId",
            p.sku AS "sku",
            p.name AS "name",
            p."type" AS "type",
            p."minStock"::float8 AS "minStock",
            COALESCE(SUM(sb.available), 0)::float8 AS "available"
          ${aggregated}
          ORDER BY (COALESCE(SUM(sb.available), 0) - p."minStock") ASC, p.id ASC
          LIMIT ${take} OFFSET ${skip}
        `);
        return rows.map((r) => ({
          ...r,
          gap: r.available - r.minStock,
          status: classifyReplenishment(r.minStock, r.available),
        }));
      },
    });
  }
}
