import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DebtorType, FinancialEntryStatus, FinancialEntryType, SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscountPolicyService } from './discount-policy.service';
import { StockService } from '../stock/stock.service';
import { TaxCalculationService, missingTaxRuleMessage } from '../tax/tax-calculation.service';
import { nfceUnidentifiedLimit } from '../fiscal/fiscal-validator';
import { AcquirerService } from '../acquirer/acquirer.service';
import { isCardMethod } from '../acquirer/payment-classification';
import { PaymentAuthorizationService } from '../payment-gateway/payment-authorization.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { SalesPaymentInputDto } from './dto/sales-payment.dto';
import { ReturnOrderDto } from './dto/return-order.dto';
import { SALE_CONFIRMED_EVENT, SaleConfirmedEvent } from './events/sale-confirmed.event';
import { SALE_INVOICED_EVENT, SaleInvoicedEvent } from './events/sale-invoiced.event';
import { SALE_RETURNED_EVENT, SaleReturnedEvent } from './events/sale-returned.event';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly stockService: StockService,
    private readonly taxCalc: TaxCalculationService,
    private readonly discountPolicy: DiscountPolicyService,
    private readonly acquirerService: AcquirerService,
    private readonly paymentAuth: PaymentAuthorizationService,
  ) {}

  // ─── Autorização de cartão (#596) ─────────────────────────────────────────

  /** Passa as formas de cartão da venda no TEF/gateway; gate do faturamento */
  async authorizeCards(id: string, companyId: string) {
    return this.paymentAuth.authorizeCardPayments(id, companyId);
  }

  // ─── Plano de pagamento (#584) ────────────────────────────────────────────

  /**
   * Valida o plano (soma fecha itens + frete) e congela MDR/prazo de liquidação
   * da taxa vigente da adquirente. Retorna as linhas prontas p/ criar (#584/#585).
   */
  private async buildPaymentsData(
    companyId: string,
    payments: SalesPaymentInputDto[],
    expectedTotal: number,
  ) {
    const sum = payments.reduce((s, p) => s + p.amount, 0);
    // Tolerância de meio centavo: diferença de R$0,01 já é discrepância real
    // (valores têm 2 casas), então > 0.005 rejeita 1 centavo mas aceita o exato.
    if (Math.abs(sum - expectedTotal) > 0.005) {
      throw new BadRequestException(
        `Plano de pagamento não fecha: formas somam R$ ${sum.toFixed(2)}, ` +
          `venda + frete = R$ ${expectedTotal.toFixed(2)}`,
      );
    }

    const rows: any[] = [];
    for (const p of payments) {
      const installments = p.installments ?? 1;
      const isCard = isCardMethod(p.method);

      if (!isCard) {
        rows.push({ method: p.method, amount: p.amount, installments });
        continue;
      }

      if (!p.acquirerId) {
        throw new BadRequestException(
          `Pagamento com ${p.method} exige a adquirente (acquirerId) para resolver taxa e prazo de liquidação`,
        );
      }
      const modality = AcquirerService.modalityFor(p.method, installments)!;
      const fee = await this.acquirerService.resolveFee(companyId, {
        acquirerId: p.acquirerId,
        brand: p.brand,
        modality,
        installments,
      });
      if (!fee) {
        throw new BadRequestException(
          `Nenhuma taxa vigente para ${p.method} ${installments}x` +
            `${p.brand ? ` (${p.brand})` : ''} nessa adquirente. Cadastre a taxa MDR antes de vender.`,
        );
      }
      // Congela taxa/prazo no momento da venda — mudança de contrato não retroage
      const mdrAmount = Math.round(p.amount * fee.mdrRate) / 100;
      rows.push({
        method: p.method,
        amount: p.amount,
        installments,
        acquirerId: p.acquirerId,
        brand: p.brand?.toUpperCase() ?? null,
        mdrRate: fee.mdrRate,
        mdrAmount,
        settlementDays: fee.settlementDays,
      });
    }
    return rows;
  }

  // ─── S07.02: Criar OV em rascunho ────────────────────────────────────────

  async createOrder(dto: CreateSalesOrderDto, companyId: string, userId?: string, userRole?: string) {
    // #391: desconto acima da alçada do papel bloqueia a criação
    await this.discountPolicy.assertWithinLimit(companyId, userRole, dto.items, userId);

    // #475: padrões comerciais do cadastro pré-preenchem a OV quando omitidos
    let defaultCarrierId: string | undefined;
    if (dto.customerId && !dto.carrierId) {
      const cust = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, companyId },
        select: { defaultCarrierId: true },
      });
      defaultCarrierId = (cust as any)?.defaultCarrierId ?? undefined;
    }

    // #584: plano de pagamento — valida soma (itens + frete) e congela MDR/prazo
    let paymentsData: any[] | undefined;
    if (dto.payments?.length) {
      const itemsTotal = dto.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const expectedTotal = itemsTotal + (dto.freightValue ?? 0);
      paymentsData = await this.buildPaymentsData(companyId, dto.payments, expectedTotal);
    }
    // Retrocompat detPag: forma legada = a de maior valor do plano
    const legacyMethod =
      dto.paymentMethod ??
      (paymentsData?.length
        ? [...paymentsData].sort((a, b) => b.amount - a.amount)[0].method
        : undefined);

    // #595: venda balcão — o chassi é escaneado no ato e amarrado ao item.
    // Valida antes de gravar (produto/depósito/disponibilidade do serial).
    const channel = dto.channel ?? 'FACTORY';
    if (channel === 'COUNTER') {
      await this.validateCounterSerials(companyId, dto.warehouseId, dto.items);
    }

    const order = await this.prisma.salesOrder.create({
      data: {
        companyId,
        warehouseId: dto.warehouseId,
        customerId: dto.customerId,
        notes: dto.notes,
        channel,
        paymentMethod: legacyMethod,
        ...(paymentsData ? { payments: { create: paymentsData } } : {}),
        deliveryAddressId: dto.deliveryAddressId,
        // Frete → grupo transp da NF-e (#481)
        freightModality: dto.freightModality,
        freightValue: dto.freightValue,
        carrierId: dto.carrierId ?? defaultCarrierId,
        volumesQuantity: dto.volumesQuantity,
        volumesSpecies: dto.volumesSpecies,
        createdById: userId,
        status: SalesOrderStatus.DRAFT,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unit: (item.unit as any) ?? 'UN',
            // #595: no balcão o chassi já vem no item; na fábrica é a separação que amarra
            serialNumberId: channel === 'COUNTER' ? item.serialNumberId ?? null : null,
          })),
        },
      },
      include: { items: { include: { product: true } }, customer: true, warehouse: true, payments: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SalesOrder',
        action: 'CREATE',
        payload: { salesOrderId: order.id, itemCount: dto.items.length },
      },
    });

    return order;
  }

  // ─── #595: venda balcão (COUNTER) ────────────────────────────────────────

  /**
   * #595 — chassis escaneáveis no balcão: IN_STOCK, livres, do produto e
   * depósito da venda. Exposto pelo domínio de vendas (permission
   * sales.orders.reserve) porque VENDEDOR/LOJA_OPERACIONAL não têm
   * stock.serials.view — o balcão só enxerga o recorte da própria venda.
   */
  async listCounterSerials(companyId: string, productId: string, warehouseId: string) {
    if (!productId || !warehouseId) {
      throw new BadRequestException('productId e warehouseId são obrigatórios');
    }
    return this.prisma.serialNumber.findMany({
      where: {
        companyId,
        productId,
        warehouseId,
        status: 'IN_STOCK' as any,
        salesOrderId: null,
      },
      select: { id: true, serial: true, chassi: true, descricaoCor: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  /**
   * #595 — valida os chassis escaneados na venda balcão: cada item rastreável
   * precisa de um SerialNumber IN_STOCK, do mesmo produto, no depósito da venda,
   * ainda não amarrado a outra OV. Rastreável no balcão vende 1 unidade/linha
   * (um chassi por SaleItem, igual ao modelo da conferência #491).
   */
  private async validateCounterSerials(
    companyId: string,
    warehouseId: string,
    items: Array<{ productId: string; quantity: number; serialNumberId?: string }>,
  ) {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true, name: true, tracksSerial: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const seen = new Set<string>();
    for (const item of items) {
      const product = byId.get(item.productId);
      if (!product?.tracksSerial) continue; // item sem chassi segue como venda normal

      if (!item.serialNumberId) {
        throw new BadRequestException(
          `Venda balcão: escaneie o chassi de "${product.name}" antes de fechar.`,
        );
      }
      if (Number(item.quantity) !== 1) {
        throw new BadRequestException(
          `Venda balcão: "${product.name}" é rastreável por chassi — ` +
            'venda 1 unidade por linha (um chassi por item).',
        );
      }
      if (seen.has(item.serialNumberId)) {
        throw new BadRequestException(`Chassi ${item.serialNumberId} repetido na mesma venda.`);
      }
      seen.add(item.serialNumberId);

      const serial = await this.prisma.serialNumber.findFirst({
        where: { id: item.serialNumberId, companyId },
        select: {
          id: true, serial: true, productId: true,
          warehouseId: true, status: true, salesOrderId: true,
        },
      });
      if (!serial) {
        throw new BadRequestException(`Chassi ${item.serialNumberId} não encontrado.`);
      }
      if (serial.productId !== item.productId) {
        throw new BadRequestException(`Chassi ${serial.serial} não pertence ao produto "${product.name}".`);
      }
      if (serial.warehouseId !== warehouseId) {
        throw new BadRequestException(`Chassi ${serial.serial} não está no depósito da venda.`);
      }
      if (serial.status !== 'IN_STOCK') {
        throw new BadRequestException(`Chassi ${serial.serial} não está disponível (status ${serial.status}).`);
      }
      if (serial.salesOrderId) {
        throw new BadRequestException(`Chassi ${serial.serial} já está vinculado a outra venda.`);
      }
    }
  }

  /**
   * #584/#585 — adquirentes selecionáveis no plano de pagamento: SÓ id+nome.
   * As TAXAS negociadas são restritas a FINANCEIRO (decisão Rafael, #623 E1) —
   * o vendedor escolhe a maquininha sem enxergar MDR; o resolver congela a
   * taxa no backend.
   */
  listAcquirerOptions(companyId: string) {
    return this.prisma.acquirer.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * #595 — fecha a venda balcão: DRAFT → READY_TO_INVOICE direto, sem
   * separação/conferência. Reserva o estoque e amarra o(s) chassi(s)
   * (IN_STOCK → RESERVED_FOR_SALE). A partir daqui segue o fluxo normal:
   * autorizar cartão (#596) → faturar (#492 exige o chassi, já vinculado).
   */
  async checkoutCounterSale(id: string, companyId: string, userId?: string, userRole?: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: { items: { include: { product: true } }, customer: true },
    });
    if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
    if ((order as any).channel !== 'COUNTER') {
      throw new BadRequestException(
        'Fechamento de balcão só se aplica a vendas do canal COUNTER. ' +
          'Use o fluxo de separação (reservar → confirmar) para vendas de fábrica.',
      );
    }
    if (order.status !== SalesOrderStatus.DRAFT) {
      throw new BadRequestException(
        `Venda balcão não pode ser fechada. Status atual: ${order.status}. ` +
          'Apenas vendas em rascunho (DRAFT) podem ser fechadas no balcão.',
      );
    }
    if (order.items.length === 0) {
      throw new BadRequestException('Venda sem itens não pode ser fechada');
    }

    // #475/#591: cliente com faturamento bloqueado não fecha. DIRECTOR sobrepõe.
    const cust = order.customer as any;
    if (cust?.billingBlocked && userRole !== 'DIRECTOR' && userRole !== 'SUPER_ADMIN') {
      throw new BadRequestException(
        `Cliente com faturamento bloqueado${cust.billingBlockReason ? `: ${cust.billingBlockReason}` : ''}. ` +
          'Somente DIRECTOR pode fechar a venda mesmo assim.',
      );
    }

    // W16-40 (NT 2026.002, em produção na SEFAZ desde 15/06/2026): acima do
    // limite, documento fiscal SEM CPF/CNPJ do destinatário é rejeitado.
    // Bloquear AQUI (antes de autorizar cartão e reservar chassi) — falhar na
    // emissão seria tarde: pagamento já capturado e estoque preso.
    const total = (order.items as any[]).reduce(
      (sum, i) => sum + Number(i.quantity) * Number(i.unitPrice),
      0,
    );
    const limit = nfceUnidentifiedLimit();
    if (total > limit && !cust?.document) {
      throw new BadRequestException(
        `Venda de R$ ${total.toFixed(2)} exige identificação do cliente (CPF/CNPJ) — ` +
          `acima de R$ ${limit.toFixed(2)} a SEFAZ rejeita documento sem destinatário ` +
          '(regra W16-40, NT 2026.002). Identifique o cliente antes de fechar.',
      );
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      for (const item of order.items as any[]) {
        const qty = Number(item.quantity);

        // Reserva a quantidade no saldo (mesmo modelo do reserveOrder da fábrica)
        const balance = await tx.stockBalance.findUnique({
          where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: item.productId } },
        });
        const available = Number(balance?.available ?? 0);
        if (available < qty) {
          throw new BadRequestException(
            `Estoque insuficiente para "${item.product?.name ?? item.productId}". ` +
              `Disponível: ${available}, solicitado: ${qty}`,
          );
        }
        await this.stockService.reserveBalance(order.warehouseId, item.productId, qty, companyId, tx);

        // Amarra o chassi com guarda de concorrência: só flipa se ainda IN_STOCK
        // e livre — fecha a corrida de dois vendedores no mesmo reboque.
        if (item.product?.tracksSerial && item.serialNumberId) {
          const moved = await tx.serialNumber.updateMany({
            where: { id: item.serialNumberId, companyId, status: 'IN_STOCK' as any, salesOrderId: null },
            data: { status: 'RESERVED_FOR_SALE' as any, salesOrderId: id },
          });
          if (moved.count !== 1) {
            throw new BadRequestException(
              `Chassi de "${item.product?.name}" não está mais disponível — outra venda o reservou. Escaneie outro.`,
            );
          }
        }
      }

      return tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.READY_TO_INVOICE },
        include: { items: { include: { product: true } }, customer: true, warehouse: true, payments: true },
      });
    });

    // #475: alerta (não bloqueia) se cliente estoura limite — cartão autorizado
    // não consome limite (título nasce contra a adquirente), então só alerta
    // quando NÃO há cartão cobrindo a venda.
    const hasCard = (closed.payments ?? []).some((p: any) => isCardMethod(p.method));
    const creditAlert = hasCard
      ? null
      : await this.buildCreditAlert(companyId, order.customerId, order.items as any[]);

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SalesOrder',
        action: 'COUNTER_CHECKOUT',
        payload: { salesOrderId: id, items: order.items.length },
      },
    });

    return { ...closed, ...(creditAlert && { creditAlert }) };
  }

  // ─── S07.02b: Redefinir plano de pagamento antes do faturamento (#584) ────

  async setPayments(
    id: string,
    companyId: string,
    payments: SalesPaymentInputDto[],
    userId?: string,
  ) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);

    const editableStatuses: SalesOrderStatus[] = [
      SalesOrderStatus.DRAFT,
      SalesOrderStatus.RESERVED,
      SalesOrderStatus.CONFIRMED,
      SalesOrderStatus.AWAITING_PICKING,
      SalesOrderStatus.AWAITING_CONFERENCE,
      SalesOrderStatus.READY_TO_INVOICE,
    ];
    if (!editableStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Plano de pagamento não pode ser alterado com a venda ${order.status} — apenas antes do faturamento`,
      );
    }

    const itemsTotal = order.items.reduce(
      (s, i) => s + Number(i.quantity) * Number(i.unitPrice),
      0,
    );
    const expectedTotal = itemsTotal + Number(order.freightValue ?? 0);
    const paymentsData = await this.buildPaymentsData(companyId, payments, expectedTotal);
    const legacyMethod = [...paymentsData].sort((a, b) => b.amount - a.amount)[0].method;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.salesPayment.deleteMany({ where: { salesOrderId: id } });
      return tx.salesOrder.update({
        where: { id },
        data: {
          paymentMethod: legacyMethod, // retrocompat detPag
          payments: { create: paymentsData },
        },
        include: { payments: true },
      });
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SalesOrder',
        action: 'SET_PAYMENTS',
        payload: { salesOrderId: id, forms: paymentsData.length },
      },
    });

    return updated;
  }

  // ─── S07.03: Reservar estoque (DRAFT → RESERVED) ─────────────────────────

  async reserveOrder(id: string, companyId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id, companyId },
        include: { items: true },
      });

      if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
      if (order.status !== SalesOrderStatus.DRAFT) {
        throw new BadRequestException(
          `Venda não pode ser reservada. Status atual: ${order.status}`,
        );
      }
      if (order.items.length === 0) {
        throw new BadRequestException('Venda sem itens não pode ser reservada');
      }

      // #230: Use StockService facade for reserve operations
      for (const item of order.items) {
        const balance = await tx.stockBalance.findUnique({
          where: {
            warehouseId_productId: {
              warehouseId: order.warehouseId,
              productId: item.productId,
            },
          },
        });

        const available = Number(balance?.available ?? 0);
        const qty = Number(item.quantity);

        if (available < qty) {
          throw new BadRequestException(
            `Estoque insuficiente para o produto ${item.productId}. ` +
              `Disponível: ${available}, solicitado: ${qty}`,
          );
        }

        await this.stockService.reserveBalance(
          order.warehouseId, item.productId, qty, companyId, tx,
        );
      }

      const reserved = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.RESERVED },
        include: { items: { include: { product: true } }, customer: true, warehouse: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'SalesOrder',
          action: 'RESERVE',
          payload: { salesOrderId: id, warehouseId: order.warehouseId },
        },
      });

      return reserved;
    });
  }

  // ─── S07.04a: Confirmar venda (RESERVED → AWAITING_PICKING) ────────────────
  //   Confirmação comercial. Dispara criação de PickingOrder via evento.
  //   Picking deve ser concluído antes do faturamento.

  async confirmOrder(id: string, companyId: string, userId?: string, userRole?: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: { items: true, customer: true },
    });

    if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
    if (order.status !== SalesOrderStatus.RESERVED) {
      throw new BadRequestException(
        `Venda não pode ser confirmada. Status atual: ${order.status}. ` +
          `Apenas vendas RESERVADAS podem ser confirmadas.`,
      );
    }

    // #475: cliente com faturamento bloqueado não confirma OV.
    // DIRECTOR/SUPER_ADMIN podem sobrepor (decisão comercial consciente).
    const cust = order.customer as any;
    if (cust?.billingBlocked && userRole !== 'DIRECTOR' && userRole !== 'SUPER_ADMIN') {
      throw new BadRequestException(
        `Cliente com faturamento bloqueado${cust.billingBlockReason ? `: ${cust.billingBlockReason}` : ''}. ` +
          'Somente DIRECTOR pode confirmar a venda mesmo assim.',
      );
    }

    const confirmed = await this.prisma.salesOrder.update({
      where: { id },
      data: { status: SalesOrderStatus.AWAITING_PICKING, confirmedAt: new Date() },
      include: { items: { include: { product: true } }, customer: true, warehouse: true },
    });

    // #475: alerta (não bloqueio) quando em aberto + esta OV estoura o limite
    const creditAlert = await this.buildCreditAlert(companyId, order.customerId, order.items as any[]);

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SalesOrder',
        action: 'CONFIRM',
        payload: { salesOrderId: id },
      },
    });

    // Emitir após commit — WMS ouve para criar PickingOrder
    this.eventEmitter.emit(
      SALE_CONFIRMED_EVENT,
      new SaleConfirmedEvent(
        confirmed.companyId,
        userId,
        confirmed.id,
        confirmed.warehouseId,
        (confirmed.items as any[]).map((i) => ({
          productId: i.productId,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
        })),
      ),
    );

    return { ...confirmed, ...(creditAlert && { creditAlert }) };
  }

  // ─── S07.04a2: Marcar como pronto para faturar (AWAITING_PICKING → READY_TO_INVOICE)
  //   Chamado pelo listener quando PickingOrder.status = DONE.

  async markReadyToInvoice(salesOrderId: string) {
    // tenant-lint: ok (chamado por listener interno (picking DONE): id vem de registro próprio, não de input do usuário)
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId },
    });

    if (!order) throw new NotFoundException(`Venda ${salesOrderId} não encontrada`);
    if (order.status !== SalesOrderStatus.AWAITING_PICKING) {
      throw new BadRequestException(
        `Venda não pode ser marcada como pronta. Status atual: ${order.status}`,
      );
    }

    // #491: separação concluída → conferência da carga (nova etapa antes da NF-e)
    // tenant-lint: ok (transição interna do mesmo pedido carregado acima)
    return this.prisma.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: SalesOrderStatus.AWAITING_CONFERENCE, pickedAt: new Date() },
      include: { items: { include: { product: true } }, customer: true, warehouse: true },
    });
  }

  // ─── #491: Conferência da carga (AWAITING_CONFERENCE → READY_TO_INVOICE) ──
  //   Dupla checagem independente da separação: quantidades + re-scan do chassi.

  /**
   * #475 — situação de crédito do cliente: em aberto (Receivable OPEN/OVERDUE)
   * + valor adicional, contra o creditLimit. Retorna null sem limite ou dentro dele.
   */
  private async buildCreditAlert(
    companyId: string,
    customerId: string | null,
    items: Array<{ quantity: any; unitPrice: any }>,
  ): Promise<string | null> {
    if (!customerId) return null;
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { creditLimit: true, name: true },
    });
    if (!customer?.creditLimit) return null;
    const orderTotal = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
    // Em aberto vive em FinancialEntry (AUTO_SALES cria lá; a tabela Receivable
    // é do módulo de cobrança #382-399 e ainda não é populada pelas vendas)
    const open = await this.prisma.financialEntry.aggregate({
      where: {
        companyId,
        type: 'RECEIVABLE' as any,
        status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] as any },
        salesOrder: { customerId },
        // #586: cartão autorizado é dívida da ADQUIRENTE — não consome limite do cliente
        debtorType: DebtorType.CUSTOMER,
      },
      _sum: { amount: true },
    });
    const openTotal = Number(open._sum.amount ?? 0);
    const limit = Number(customer.creditLimit);
    if (openTotal + orderTotal <= limit) return null;
    return (
      `Limite de crédito excedido: em aberto R$ ${openTotal.toFixed(2)} + esta venda R$ ${orderTotal.toFixed(2)} ` +
      `> limite R$ ${limit.toFixed(2)} (${customer.name})`
    );
  }

  async conferOrder(
    id: string,
    companyId: string,
    dto: { items: { saleItemId: string; quantity: number; serialNumberId?: string }[] },
    userId?: string,
  ) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: { items: { include: { product: true, serialNumber: true } } },
    });
    if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
    if (order.status !== SalesOrderStatus.AWAITING_CONFERENCE) {
      throw new BadRequestException(
        `Venda não está aguardando conferência. Status atual: ${order.status}`,
      );
    }

    const divergencias: string[] = [];
    for (const item of order.items as any[]) {
      const conf = dto.items.find((c) => c.saleItemId === item.id);
      if (!conf) {
        divergencias.push(`Item ${item.product?.name ?? item.productId} não foi conferido`);
        continue;
      }
      if (Number(conf.quantity) !== Number(item.quantity)) {
        divergencias.push(
          `${item.product?.name}: conferido ${conf.quantity}, esperado ${Number(item.quantity)}`,
        );
      }
      // re-scan do chassi deve bater com o serial amarrado na separação
      if (item.product?.tracksSerial) {
        if (!item.serialNumberId) {
          divergencias.push(`${item.product.name}: sem chassi vinculado na separação`);
        } else if (conf.serialNumberId !== item.serialNumberId) {
          divergencias.push(
            `${item.product.name}: chassi conferido não confere com o separado (${item.serialNumber?.chassi ?? item.serialNumberId})`,
          );
        }
      }
    }
    if (divergencias.length > 0) {
      throw new BadRequestException(`Divergência na conferência: ${divergencias.join('; ')}`);
    }

    const conferred = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        status: SalesOrderStatus.READY_TO_INVOICE,
        conferredAt: new Date(),
        conferredById: userId ?? null,
      },
      include: { items: { include: { product: true } }, customer: true, warehouse: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SalesOrder',
        action: 'CONFER',
        payload: { salesOrderId: id, itemCount: dto.items.length },
      },
    });

    return conferred;
  }

  // ─── S07.04b: Faturar venda (READY_TO_INVOICE → INVOICED) — baixa estoque ──
  //   Picking deve estar concluído. Gera StockMovement EXIT e emite evento para fiscal e financeiro.

  async invoiceOrder(id: string, companyId: string, userId?: string) {
    const invoiced = await this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id, companyId },
        include: { items: { include: { product: true, serialNumber: true } }, pickingOrder: true, customer: true, company: true, payments: true },
      });

      if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
      if (order.status !== SalesOrderStatus.READY_TO_INVOICE) {
        throw new BadRequestException(
          `Venda não pode ser faturada. Status atual: ${order.status}. ` +
            `Apenas vendas com picking concluído (READY_TO_INVOICE) podem ser faturadas.`,
        );
      }

      // Validação de segurança: picking deve estar DONE (se WMS ativo)
      // #220: non-WMS warehouses don't have a pickingOrder
      if (order.pickingOrder && order.pickingOrder.status !== 'DONE') {
        throw new BadRequestException(
          'Picking não concluído. Conclua todas as tarefas de picking antes de faturar.',
        );
      }

      // #596: gate de pagamento — toda forma de cartão precisa estar AUTHORIZED
      // (TEF/gateway) antes de emitir a NF-e. Sem isso, faturaria sem cobrar.
      if (PaymentAuthorizationService.hasUnauthorizedCard(order.payments ?? [])) {
        throw new BadRequestException(
          'Pagamento com cartão não autorizado. Passe o cartão (POST /sales/:id/authorize) e ' +
            'aguarde a autorização antes de faturar.',
        );
      }

      // #498: pré-checagem de cobertura fiscal ANTES de consumir estoque —
      // sem regra cadastrada o Faturar falha limpo, com ação orientada,
      // em vez de emitir nota com tributação genérica (ex-FALLBACK_RULE)
      const ufEmpresa = order.company?.state ?? 'PR';
      const isInterstate = order.customer?.state && ufEmpresa !== order.customer.state;
      const operationType = (isInterstate ? 'VENDA_INTERESTADUAL' : 'VENDA_INTERNA') as any;
      for (const item of order.items as any[]) {
        const ruleInput = {
          companyId,
          operationType,
          ncm: item.product?.ncm ?? undefined,
          productType: item.product?.type,
          ufOrigem: ufEmpresa,
          ufDestino: order.customer?.state ?? ufEmpresa,
        };
        const rule = await this.taxCalc.findBestRule(ruleInput, tx as any);
        if (!rule) {
          throw new BadRequestException(missingTaxRuleMessage(ruleInput as any));
        }
      }

      // #492: item rastreável não fatura sem chassi — a NF-e precisa do
      // veicProd do reboque que fisicamente saiu (emplacamento)
      const semChassi = (order.items as any[]).filter(
        (i) => i.product?.tracksSerial && !i.serialNumberId,
      );
      if (semChassi.length > 0) {
        throw new BadRequestException(
          `Itens sem chassi vinculado: ${semChassi.map((i) => i.product.name).join(', ')}. ` +
            'Conclua a separação escolhendo o chassi de cada unidade antes de faturar.',
        );
      }

      for (const item of order.items) {
        const qty = Number(item.quantity);

        // #230: Use StockService facade for invoice stock consumption
        await this.stockService.consumeReserved(
          order.warehouseId, item.productId, qty, companyId,
          `Faturamento OV #${id}`, userId, tx,
        );
      }

      // #492: chassis reservados na separação viram SOLD na fatura
      await tx.serialNumber.updateMany({
        where: { salesOrderId: id, status: 'RESERVED_FOR_SALE' as any },
        data: { status: 'SOLD' as any, soldAt: new Date() },
      });

      const updated = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.INVOICED, invoicedAt: new Date() },
        include: { items: { include: { product: true } }, customer: true, warehouse: true, company: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'SalesOrder',
          action: 'INVOICE',
          payload: { salesOrderId: id, warehouseId: order.warehouseId },
        },
      });

      return updated;
    });

    // Emitir após commit — fiscal e financeiro ouvem este evento
    this.eventEmitter.emit(
      SALE_INVOICED_EVENT,
      new SaleInvoicedEvent(
        invoiced.companyId,
        userId,
        invoiced.id,
        invoiced.warehouseId,
        (invoiced.items as any[]).map((i) => ({
          saleItemId: i.id,
          productId: i.productId,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
        })),
        (invoiced as any).customer?.type,
        (invoiced as any).customer?.state,
        (invoiced as any).company?.state,
        (invoiced.items as any[]).some(
          (i) => i.product?.codigoMarcaModelo || i.product?.tracksSerial,
        ),
      ),
    );

    return invoiced;
  }

  // ─── S07.06: Devolução (INVOICED → RETURNED) — entrada de estoque ─────────

  async returnOrder(id: string, companyId: string, dto: ReturnOrderDto, userId?: string) {
    const returned = await this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id, companyId },
        include: { items: true },
      });

      if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
      if (order.status !== SalesOrderStatus.INVOICED) {
        throw new BadRequestException(
          `Devolução só é permitida para vendas faturadas. Status atual: ${order.status}`,
        );
      }

      // 1. Reverter estoque: entrada de todos os itens
      // #230: Use StockService facade for return stock entry
      for (const item of order.items) {
        const qty = Number(item.quantity);
        await this.stockService.returnStock(
          order.warehouseId, item.productId, qty, companyId,
          `Devolução OV #${id}: ${dto.reason}`, userId, tx,
        );
      }

      // 2. Cancelar CRs (contas a receber) vinculadas (#178) — 1:N desde #586.
      // Só RECEIVABLE: não varrer eventuais PAYABLE da mesma OV.
      const entries = await tx.financialEntry.findMany({
        where: { salesOrderId: id, type: FinancialEntryType.RECEIVABLE },
      });

      let crCancelled = false;
      const paid = entries.filter((e) => e.status === FinancialEntryStatus.PAID);
      if (paid.length > 0) {
        this.logger.warn(
          `${paid.length} título(s) da OV ${id} já PAGOS — necessário gerar crédito/estorno manualmente`,
        );
      }
      const cancellable = entries.filter(
        (e) =>
          e.status !== FinancialEntryStatus.PAID &&
          e.status !== FinancialEntryStatus.CANCELLED,
      );
      if (cancellable.length > 0) {
        await tx.financialEntry.updateMany({
          where: { id: { in: cancellable.map((e) => e.id) } },
          data: { status: FinancialEntryStatus.CANCELLED },
        });
        crCancelled = true;
        this.logger.log(
          `${cancellable.length} título(s) → CANCELLED (devolução OV ${id})`,
        );
      }

      // 3. Atualizar status da venda
      // #492: devolução física — chassis voltam ao estoque
      await tx.serialNumber.updateMany({
        where: { salesOrderId: id, status: { in: ['SOLD', 'RESERVED_FOR_SALE'] as any } },
        data: { status: 'IN_STOCK' as any, soldAt: null, salesOrderId: null },
      });

      const updated = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.RETURNED, returnedAt: new Date() },
        include: { items: { include: { product: true } }, customer: true, warehouse: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'SalesOrder',
          action: 'RETURN',
          payload: { salesOrderId: id, reason: dto.reason, crCancelled },
        },
      });

      return updated;
    });

    // 4. Lado fiscal (#747, fora da transação): o FiscalListener ouve o evento e
    // cancela a NF-e NA SEFAZ (<24h) ou emite a NF-e de devolução referenciada
    // (>24h). Antes o cancelamento só marcava CANCELLED no banco, sem SEFAZ.
    // 5. vehicle-tracking cancela a saída RENAVE (#531).
    // Fire-and-forget: falha externa nunca desfaz a devolução interna.
    this.eventEmitter.emit(
      SALE_RETURNED_EVENT,
      new SaleReturnedEvent(companyId, id, dto.justificativa ?? dto.reason),
    );

    return returned;
  }

  // ─── S07.05: Cancelar venda ───────────────────────────────────────────────
  //   Permitido em DRAFT, RESERVED e CONFIRMED.
  //   RESERVED e CONFIRMED: devolve estoque reservado para disponível.
  //   INVOICED: não pode cancelar — usar devolução.

  async cancelOrder(id: string, companyId: string, userId?: string) {
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id, companyId },
        include: { items: true },
      });

      if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
      if (order.status === SalesOrderStatus.INVOICED) {
        throw new BadRequestException(
          'Venda já faturada não pode ser cancelada. Use o endpoint de devolução.',
        );
      }
      if (order.status === SalesOrderStatus.RETURNED) {
        throw new BadRequestException('Venda devolvida não pode ser cancelada');
      }
      if (order.status === SalesOrderStatus.CANCELLED) {
        throw new BadRequestException('Venda já está cancelada');
      }

      const needsStockRevert =
        order.status === SalesOrderStatus.RESERVED ||
        order.status === SalesOrderStatus.CONFIRMED ||
        order.status === SalesOrderStatus.AWAITING_PICKING ||
        order.status === SalesOrderStatus.READY_TO_INVOICE;

      // #230: Use StockService facade for cancel stock release
      if (needsStockRevert) {
        for (const item of order.items) {
          const qty = Number(item.quantity);
          await this.stockService.releaseBalance(
            order.warehouseId, item.productId, qty, tx,
          );
        }
      }

      // #492: cancelamento libera chassis reservados na separação
      await tx.serialNumber.updateMany({
        where: { salesOrderId: id, status: 'RESERVED_FOR_SALE' as any },
        data: { status: 'IN_STOCK' as any, salesOrderId: null },
      });

      const cancelled = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.CANCELLED, cancelledAt: new Date() },
        include: { items: { include: { product: true } }, customer: true, warehouse: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          companyId,
          entity: 'SalesOrder',
          action: 'CANCEL',
          payload: { salesOrderId: id, previousStatus: order.status },
        },
      });

      return cancelled;
    });

    // #596: cartão autorizado no TEF antes do faturamento precisa ser ESTORNADO
    // quando a venda morre — senão o valor fica preso no cartão do cliente.
    // Fora da transação e fail-safe: falha no TEF não desfaz o cancelamento
    // (voidCardPayments loga por pagamento; aqui é o cinto extra).
    try {
      await this.paymentAuth.voidCardPayments(id, companyId);
    } catch (err) {
      this.logger.error(
        `OV ${id} cancelada, mas estorno TEF falhou: ${(err as Error).message} — estornar manualmente na adquirente`,
      );
    }

    return cancelled;
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  async findAll(
    companyId: string,
    filters: {
      status?: SalesOrderStatus;
      customerId?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    return this.prisma.salesOrder.findMany({
      where: {
        companyId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        customer: true,
        warehouse: true,
        items: { include: { product: true, serialNumber: true } }, // chassi visível na conferência (#491)
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: {
        customer: true,
        warehouse: true,
        items: { include: { product: true, serialNumber: { select: { id: true, serial: true, chassi: true } } } },
        createdBy: { select: { id: true, name: true } },
        // #584: plano de pagamento no detalhe (formas, MDR congelada, autorização TEF)
        payments: { include: { acquirer: { select: { id: true, name: true } } } },
      },
    });

    if (!order) throw new NotFoundException(`Venda ${id} não encontrada`);
    return order;
  }

}
