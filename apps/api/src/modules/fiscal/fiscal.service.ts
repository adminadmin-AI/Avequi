import { BadRequestException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FiscalDocumentType, FiscalStatus, PaymentMethod, TaxOperationType } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EMISSOR_PORT, EmissorPort } from './emissor.port';
import { formatValidationIssues, validateNfePayload } from './fiscal-validator';
import { TaxCalculationService } from '../tax/tax-calculation.service';
import { FISCAL_CANCELLED_EVENT, FiscalCancelledEvent } from './events/fiscal-cancelled.event';
import {
  buildNFCePayload,
  buildNFePayload,
  buildTransferNFePayload,
  calcTotalValue,
  FiscalItem,
  FiscalPayloadInput,
  FiscalVehicleData,
  cardBrandCode,
} from './fiscal-mapper';

const CANCEL_DEADLINE_HOURS = 24;

@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMISSOR_PORT) private readonly client: EmissorPort,
    private readonly taxCalc: TaxCalculationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── S08.03: Emitir NF para venda confirmada ──────────────────────────────

  async emitForSale(
    salesOrderId: string,
    type: FiscalDocumentType = FiscalDocumentType.NFCE,
  ): Promise<void> {
    // Evita duplicata — se já existe, não emite novamente
    const existing = await this.prisma.fiscalDocument.findUnique({
      where: { salesOrderId },
    });
    if (existing && existing.status !== FiscalStatus.REJECTED && existing.status !== FiscalStatus.ERROR) {
      this.logger.warn(`Documento fiscal já existe para OV ${salesOrderId}: status=${existing.status}`);
      return;
    }

    // Buscar OV completa com relações necessárias
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: {
        company: true,
        customer: true,
        deliveryAddress: true,
        carrier: true,
        items: { include: { product: true, serialNumber: true } },
        // #587: plano de pagamento → detPag lista + grupo card (CNPJ credenciadora)
        payments: { include: { acquirer: { select: { cnpj: true } } } },
      },
    });

    if (!order) {
      this.logger.error(`OV ${salesOrderId} não encontrada para emissão fiscal`);
      return;
    }

    const ref = `GDR-SO-${salesOrderId}`;

    // Criar ou atualizar FiscalDocument em PENDING
    const fiscalDoc = existing
      ? await this.prisma.fiscalDocument.update({
          where: { salesOrderId },
          data: {
            status: FiscalStatus.PENDING,
            retryCount: { increment: 1 },
            lastError: null,
            rejectionCode: null,
            rejectionReason: null,
          },
        })
      : await this.prisma.fiscalDocument.create({
          data: {
            companyId: order.companyId,
            salesOrderId,
            type,
            status: FiscalStatus.PENDING,
            focusRef: ref,
          },
        });

    await this.prisma.auditLog.create({
      data: {
        companyId: order.companyId,
        entity: 'FiscalDocument',
        action: 'EMIT',
        payload: { fiscalDocumentId: fiscalDoc.id, salesOrderId, type, ref },
      },
    });

    // Montar payload com cálculo tributário
    const isInterstate = order.customer?.state && order.company.state !== order.customer.state;
    const operationType = isInterstate
      ? 'VENDA_INTERESTADUAL' as any
      : 'VENDA_INTERNA' as any;

    // Consumidor final: indicador explícito do cadastro (#474); fallback: PF (CPF) ou sem IE
    const recipientDoc = order.customer?.document?.replace(/\D/g, '') ?? '';
    const consumidorFinal = order.customer?.indIeDest
      ? order.customer.indIeDest !== 'CONTRIBUINTE'
      : !order.customer?.ie || recipientDoc.length === 11;

    const items: FiscalItem[] = [];
    try {
    for (const i of order.items) {
      const itemValue = Number(i.quantity) * Number(i.unitPrice);
      const taxResult = await this.taxCalc.calculateTaxes({
        companyId: order.companyId,
        operationType,
        ncm: i.product.ncm ?? undefined,
        productType: i.product.type,
        ufOrigem: order.company.state ?? 'SP',
        ufDestino: order.customer?.state ?? order.company.state ?? 'SP',
        itemValue,
        consumidorFinal,
        origem: i.product.origem, // importado (1/2/3/8) → interestadual 4% RSF 13/2012 (#480)
      });

      // Montar dados veiculares se o item tiver SerialNumber com chassi preenchido
      let vehicle: FiscalVehicleData | undefined;
      const sn = i.serialNumber;
      if (sn?.chassi) {
        vehicle = {
          tipoOperacao: sn.tipoOperacao ?? '0', // 0=Outros — GDR não é concessionária (#372)
          chassi: sn.chassi,
          codigoCor: sn.codigoCor ?? '00',
          descricaoCor: sn.descricaoCor ?? 'NAO INFORMADA',
          potenciaMotor: sn.potenciaMotor ?? 0,
          cilindrada: sn.cilindrada ?? 0,
          pesoLiquido: String(sn.pesoLiquido ?? '0.000'),
          pesoBruto: String(sn.pesoBruto ?? '0.000'),
          serie: sn.serial,
          tipoCombustivel: sn.tipoCombustivel ?? '11', // conforme NF-e real #14236 aceita pela SEFAZ/PR (#372)
          numeroMotor: sn.numeroMotor ?? '0',
          cmt: sn.cmt ? String(sn.cmt) : undefined,
          distanciaEixos: sn.distanciaEixos ?? undefined,
          anoModelo: sn.anoModelo ?? new Date().getFullYear(),
          anoFabricacao: sn.anoFabricacao ?? new Date().getFullYear(),
          tipoPintura: sn.tipoPintura ?? 'S',
          tipoVeiculo: sn.tipoVeiculo ?? '10',
          especieVeiculo: sn.especieVeiculo ?? '2',
          vin: sn.vin ?? 'N',
          condicao: sn.condicaoVeiculo ?? '1',
          codigoMarcaModelo: sn.codigoMarcaModelo ?? i.product.codigoMarcaModelo ?? '999999',
          corDenatran: sn.corDenatran ?? '00',
          lotacao: sn.lotacao ?? 0,
          restricao: sn.restricao ?? '0',
        };

        // Alerta #362: sem BIN REGISTERED o reboque não entra no RENAVE nem pode
        // ser emplacado — a NF-e sai, mas a pendência precisa aparecer na operação
        const bin = await this.prisma.binRegistration.findUnique({
          where: { serialNumberId: sn.id },
          select: { status: true },
        });
        if (bin?.status !== 'REGISTERED') {
          this.logger.warn(
            `Faturando chassi ${sn.chassi} sem registro BIN REGISTERED (status: ${bin?.status ?? 'SEM_REGISTRO'}) — emplacamento bloqueado até o pré-cadastro na BIN (#362)`,
          );
        }
      }

      items.push({
        sku: i.product.sku,
        name: i.product.name,
        ncm: i.product.ncm ?? '00000000',
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        unit: i.product.unit,
        origem: i.product.origem, // (#480)
        ean: i.product.ean ?? undefined, // (#484)
        cest: i.product.cest ?? undefined,
        unidadeTributavel: i.product.unidadeTributavel ?? undefined,
        fatorConversaoTributavel: i.product.fatorConversaoTributavel
          ? Number(i.product.fatorConversaoTributavel)
          : undefined,
        tax: {
          cfop: taxResult.cfop,
          icmsCst: taxResult.icms.cst,
          icmsBase: taxResult.icms.baseCalculo,
          icmsAliquota: taxResult.icms.aliquota,
          icmsValor: taxResult.icms.valor,
          ipiCst: taxResult.ipi.cst,
          ipiBase: taxResult.ipi.baseCalculo,
          ipiAliquota: taxResult.ipi.aliquota,
          ipiValor: taxResult.ipi.valor,
          pisCst: taxResult.pis.cst,
          pisBase: taxResult.pis.baseCalculo,
          pisAliquota: taxResult.pis.aliquota,
          pisValor: taxResult.pis.valor,
          cofinsCst: taxResult.cofins.cst,
          cofinsBase: taxResult.cofins.baseCalculo,
          cofinsAliquota: taxResult.cofins.aliquota,
          cofinsValor: taxResult.cofins.valor,
          ...(taxResult.difal && { difal: taxResult.difal }),
          // IBS/CBS — NT 2025.002-RTC (#415)
          ...(taxResult.cbs && {
            ibsCbs: {
              cClassTrib: taxResult.cClassTrib!,
              cbsCst: taxResult.cbs.cst,
              base: taxResult.cbs.baseCalculo,
              cbsAliquota: taxResult.cbs.aliquota,
              cbsValor: taxResult.cbs.valor,
              ibsUfAliquota: taxResult.ibsUf?.aliquota ?? 0,
              ibsUfValor: taxResult.ibsUf?.valor ?? 0,
              ibsMunAliquota: taxResult.ibsMun?.aliquota ?? 0,
              ibsMunValor: taxResult.ibsMun?.valor ?? 0,
              // gRed (#446) — presentes quando a cClassTrib tem redução (CSTs 2xx)
              cbsPRedAliq: taxResult.cbs.pRedAliq,
              cbsAliqEfet: taxResult.cbs.pAliqEfet,
              ibsUfPRedAliq: taxResult.ibsUf?.pRedAliq,
              ibsUfAliqEfet: taxResult.ibsUf?.pAliqEfet,
              ibsMunPRedAliq: taxResult.ibsMun?.pRedAliq,
              ibsMunAliqEfet: taxResult.ibsMun?.pAliqEfet,
            },
          }),
        },
        vehicle,
      });
    }
    } catch (err) {
      // #498: cálculo bloqueado (ex.: sem regra fiscal) — persiste o motivo
      // orientado no documento (visível no detalhe fiscal, Reprocessar habilitado)
      await this.prisma.fiscalDocument.update({
        where: { id: fiscalDoc.id },
        data: { status: FiscalStatus.ERROR, lastError: (err as Error).message },
      });
      throw err;
    }

    const totalValue = calcTotalValue(items);

    // Gerar informações complementares (#370)
    const infCplParts: string[] = [];

    // DIFAL: informar valor do diferencial (e FCP #445) se houver
    const totalDifal = items.reduce((sum, it) => sum + (it.tax?.difal?.valor ?? 0), 0);
    const totalFcp = items.reduce((sum, it) => sum + (it.tax?.difal?.fcpValor ?? 0), 0);
    if (totalDifal > 0) {
      infCplParts.push(
        `ICMS DIFAL recolhido: R$ ${totalDifal.toFixed(2)} — EC 87/2015, 100% UF destino` +
          (totalFcp > 0 ? `. FCP UF destino: R$ ${totalFcp.toFixed(2)}` : ''),
      );
    }

    // Veículo: informar chassi
    for (const it of items) {
      if (it.vehicle) {
        infCplParts.push(`Veículo: chassi ${it.vehicle.chassi}`);
      }
    }

    const infCpl = infCplParts.length > 0 ? infCplParts.join('. ') : undefined;

    // #587: plano multi-forma → detPag lista; cartão TEF (tpIntegra=1) leva o
    // grupo card com CNPJ da credenciadora + bandeira + autorização do gate #596
    const paymentForms = (order.payments ?? []).map((p) => {
      const isCard = p.method === 'CARTAO_CREDITO' || p.method === 'CARTAO_DEBITO' || p.method === 'CARTAO';
      const cAut = p.authCode ?? p.nsu ?? undefined;
      return {
        tPag: NFE_PAYMENT_CODES[p.method] ?? '99',
        amount: Number(p.amount),
        // sem autorização não há grupo card válido (cAut é obrigatório no tpIntegra=1)
        ...(isCard && cAut
          ? {
              card: {
                cnpjCredenciadora: (p as any).acquirer?.cnpj ?? undefined,
                tBand: cardBrandCode(p.brand),
                cAut,
              },
            }
          : {}),
      };
    });

    const input: FiscalPayloadInput = {
      ref,
      // detPag com a forma real da venda (#479); sem forma cadastrada → 99 (outros)
      paymentMethod: order.paymentMethod ? NFE_PAYMENT_CODES[order.paymentMethod] : undefined,
      ...(paymentForms.length > 0 && { payments: paymentForms }),
      emitter: {
        cnpj: order.company.cnpj,
        name: order.company.razaoSocial ?? order.company.name,
        ie: order.company.ie ?? undefined,
        crt: order.company.crt ?? undefined,
        address: order.company.street ?? 'Endereço não cadastrado',
        number: order.company.number ?? undefined,
        complement: order.company.complement ?? undefined,
        neighborhood: order.company.neighborhood ?? undefined,
        city: order.company.city ?? 'Cidade',
        state: order.company.state ?? 'SP',
        zipCode: order.company.zipCode ?? undefined,
        ibgeCode: order.company.ibgeCode ?? undefined,
        phone: order.company.phone ?? undefined,
      },
      recipient: order.customer
        ? {
            name: order.customer.name,
            razaoSocial: order.customer.razaoSocial ?? undefined,
            document: order.customer.document ?? undefined,
            ie: order.customer.ie ?? undefined,
            indIeDest: order.customer.indIeDest ?? undefined,
            email: order.customer.fiscalEmail ?? order.customer.email ?? undefined,
            address: order.customer.address ?? undefined,
            number: order.customer.number ?? undefined,
            complement: order.customer.complement ?? undefined,
            neighborhood: order.customer.neighborhood ?? undefined,
            city: order.customer.city ?? undefined,
            state: order.customer.state ?? undefined,
            zipCode: order.customer.zipCode ?? undefined,
            ibgeCode: order.customer.ibgeCode ?? undefined,
          }
        : undefined,
      // Grupo <entrega> quando a OV tem endereço de entrega (#474)
      delivery: order.deliveryAddress
        ? {
            address: order.deliveryAddress.address,
            number: order.deliveryAddress.number ?? undefined,
            complement: order.deliveryAddress.complement ?? undefined,
            neighborhood: order.deliveryAddress.neighborhood ?? undefined,
            city: order.deliveryAddress.city,
            state: order.deliveryAddress.state,
            zipCode: order.deliveryAddress.zipCode ?? undefined,
            document: order.customer?.document ?? undefined,
          }
        : undefined,
      items,
      totalValue,
      consumidorFinal,
      infCpl,
      // Grupo transp — modalidade + transportadora + volumes (#481)
      freight: this.buildFreight(order),
    };

    // Persistir itens + impostos detalhados (#166)
    await this.persistFiscalItems(fiscalDoc.id, items, order.items);

    // Totais IBS/CBS — grupo W03 (#416): vIBS = Σ(vIBSUF + vIBSMun), vCBS = Σ vCBS
    const vIBS = round2(items.reduce((s, it) => s + (it.tax?.ibsCbs ? it.tax.ibsCbs.ibsUfValor + it.tax.ibsCbs.ibsMunValor : 0), 0));
    const vCBS = round2(items.reduce((s, it) => s + (it.tax?.ibsCbs?.cbsValor ?? 0), 0));
    const hasIbsCbs = items.some((it) => it.tax?.ibsCbs);

    // Salvar infCpl (#370) e totais IBS/CBS (#416) no FiscalDocument
    if (infCpl || hasIbsCbs) {
      await this.prisma.fiscalDocument.update({
        where: { id: fiscalDoc.id },
        data: {
          ...(infCpl && { infCpl }),
          ...(hasIbsCbs && { vIBS, vCBS, vCredPres: 0, vCredPresCondSus: 0, vIBSMono: 0, vCBSMono: 0 }),
        },
      });
    }

    const payload = type === FiscalDocumentType.NFE ? buildNFePayload(input) : buildNFCePayload(input);

    // #499: validação estruturada pré-transmissão — rejeições conhecidas viram
    // erro orientado ANTES de ir à SEFAZ (mesmo padrão do bloqueio fiscal #498)
    if (await this.blockIfInvalid(fiscalDoc.id, ref, payload)) return;

    // Enviar para Focus NFe
    const response =
      type === FiscalDocumentType.NFE
        ? await this.client.emitNFe(ref, payload)
        : await this.client.emitNFCe(ref, payload);

    // Processar resposta e atualizar status
    await this.applyFocusResponse(fiscalDoc.id, response);
  }

  /**
   * #499 — roda o Fiscal Validator no payload flat; com problemas, marca o
   * documento ERROR com mensagem orientada e NÃO transmite. Retorna true se bloqueou.
   */
  private async blockIfInvalid(
    fiscalDocumentId: string,
    ref: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const issues = validateNfePayload(payload);
    if (issues.length === 0) return false;
    const msg = formatValidationIssues(issues);
    this.logger.warn(`Fiscal Validator bloqueou ${ref}: ${msg}`);
    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDocumentId },
      data: { status: FiscalStatus.ERROR, lastError: msg },
    });
    return true;
  }

  // ─── S08.04: Webhook — atualização assíncrona da Focus ────────────────────

  async handleWebhook(body: Record<string, unknown>): Promise<void> {
    const ref = body.ref as string | undefined;
    if (!ref) {
      this.logger.warn('Webhook recebido sem campo ref');
      return;
    }

    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { focusRef: ref },
    });

    if (!doc) {
      this.logger.warn(`Webhook: documento fiscal não encontrado para ref=${ref}`);
      return;
    }

    // Idempotência: se já autorizado, não sobrescreve
    if (doc.status === FiscalStatus.AUTHORIZED) {
      this.logger.log(`Webhook ignorado — documento ${doc.id} já está AUTHORIZED`);
      return;
    }

    await this.applyFocusResponse(doc.id, body as any);

    await this.prisma.auditLog.create({
      data: {
        companyId: doc.companyId,
        entity: 'FiscalDocument',
        action: 'WEBHOOK',
        payload: { fiscalDocumentId: doc.id, ref, status: body.status as string },
      },
    });
  }

  // ─── S08.05: Reprocessar rejeição ────────────────────────────────────────

  async retry(id: string, companyId: string): Promise<void> {
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id, companyId },
    });

    if (!doc) throw new NotFoundException(`Documento fiscal ${id} não encontrado`);

    if (doc.status !== FiscalStatus.REJECTED && doc.status !== FiscalStatus.ERROR) {
      throw new BadRequestException(
        `Documento não pode ser reprocessado. Status atual: ${doc.status}`,
      );
    }

    await this.emitForSale(doc.salesOrderId, doc.type);
  }

  // ─── S10: Emitir NF-e de transferência ───────────────────────────────────

  async emitForTransfer(storeTransferId: string): Promise<void> {
    // Idempotência
    const existing = await this.prisma.fiscalDocument.findUnique({
      where: { storeTransferId },
    });
    if (existing && existing.status !== FiscalStatus.REJECTED && existing.status !== FiscalStatus.ERROR) {
      this.logger.warn(`NF-e de transferência já existe para ${storeTransferId}: status=${existing.status}`);
      return;
    }

    const transfer = await this.prisma.storeTransfer.findUnique({
      where: { id: storeTransferId },
      include: {
        company: true,
        fromWarehouse: true,
        toWarehouse: { include: { company: true } },
        items: { include: { product: true } },
      },
    });

    if (!transfer) {
      this.logger.error(`Transferência ${storeTransferId} não encontrada para emissão fiscal`);
      return;
    }

    const ref = `GDR-TR-${storeTransferId}`;

    const fiscalDoc = existing
      ? await this.prisma.fiscalDocument.update({
          where: { storeTransferId },
          data: { status: FiscalStatus.PENDING, retryCount: { increment: 1 }, lastError: null },
        })
      : await this.prisma.fiscalDocument.create({
          data: {
            companyId: transfer.companyId,
            storeTransferId,
            type: FiscalDocumentType.NFE,
            status: FiscalStatus.PENDING,
            focusRef: ref,
          },
        });

    await this.prisma.auditLog.create({
      data: {
        companyId: transfer.companyId,
        entity: 'FiscalDocument',
        action: 'EMIT_TRANSFER',
        payload: { fiscalDocumentId: fiscalDoc.id, storeTransferId, ref },
      },
    });

    // Deriva a operação pelas UFs de origem (emitente) e destino (company do
    // depósito destino) — mesma UF = interna, UFs distintas = interestadual.
    const destCompany = transfer.toWarehouse.company;
    const ufOrigem = transfer.company.state ?? 'SP';
    const ufDestino = destCompany?.state ?? ufOrigem;
    const transferOpType =
      ufOrigem === ufDestino
        ? TaxOperationType.TRANSFERENCIA_INTERNA
        : TaxOperationType.TRANSFERENCIA_INTERESTADUAL;

    const items: FiscalItem[] = [];
    try {
    for (const i of transfer.items) {
      const unitPrice = Number(i.product.avgCost ?? i.product.costPrice ?? 0);
      const itemValue = Number(i.quantity) * unitPrice;
      const taxResult = await this.taxCalc.calculateTaxes({
        companyId: transfer.companyId,
        operationType: transferOpType,
        ncm: i.product.ncm ?? undefined,
        productType: i.product.type,
        ufOrigem,
        ufDestino,
        itemValue,
        origem: i.product.origem, // (#480)
      });
      items.push({
        sku: i.product.sku,
        name: i.product.name,
        ncm: i.product.ncm ?? '00000000',
        quantity: Number(i.quantity),
        unitPrice,
        unit: String(i.unit),
        origem: i.product.origem, // (#480)
        tax: {
          cfop: taxResult.cfop,
          icmsCst: taxResult.icms.cst, icmsBase: taxResult.icms.baseCalculo, icmsAliquota: taxResult.icms.aliquota, icmsValor: taxResult.icms.valor,
          ipiCst: taxResult.ipi.cst, ipiBase: taxResult.ipi.baseCalculo, ipiAliquota: taxResult.ipi.aliquota, ipiValor: taxResult.ipi.valor,
          pisCst: taxResult.pis.cst, pisBase: taxResult.pis.baseCalculo, pisAliquota: taxResult.pis.aliquota, pisValor: taxResult.pis.valor,
          cofinsCst: taxResult.cofins.cst, cofinsBase: taxResult.cofins.baseCalculo, cofinsAliquota: taxResult.cofins.aliquota, cofinsValor: taxResult.cofins.valor,
        },
      });
    }
    } catch (err) {
      // #498: sem regra fiscal → documento em ERROR com motivo orientado
      await this.prisma.fiscalDocument.update({
        where: { id: fiscalDoc.id },
        data: { status: FiscalStatus.ERROR, lastError: (err as Error).message },
      });
      throw err;
    }

    const totalValue = calcTotalValue(items);

    const input: FiscalPayloadInput = {
      ref,
      emitter: {
        cnpj: transfer.company.cnpj,
        name: transfer.company.razaoSocial ?? transfer.company.name,
        ie: transfer.company.ie ?? undefined,
        crt: transfer.company.crt ?? undefined,
        address: transfer.company.street ?? 'Endereço não cadastrado',
        number: transfer.company.number ?? undefined,
        complement: transfer.company.complement ?? undefined,
        neighborhood: transfer.company.neighborhood ?? undefined,
        city: transfer.company.city ?? 'Cidade',
        state: transfer.company.state ?? 'SP',
        zipCode: transfer.company.zipCode ?? undefined,
        ibgeCode: transfer.company.ibgeCode ?? undefined,
        phone: transfer.company.phone ?? undefined,
      },
      recipient: {
        name: destCompany?.razaoSocial ?? destCompany?.name ?? transfer.toWarehouse.name,
        document: destCompany?.cnpj,
        ie: destCompany?.ie ?? undefined,
        address: destCompany?.street ?? undefined,
        number: destCompany?.number ?? undefined,
        neighborhood: destCompany?.neighborhood ?? undefined,
        city: destCompany?.city ?? undefined,
        state: ufDestino,
        zipCode: destCompany?.zipCode ?? undefined,
        ibgeCode: destCompany?.ibgeCode ?? undefined,
      },
      items,
      totalValue,
    };

    // Persistir itens + impostos (#166)
    await this.persistFiscalItems(fiscalDoc.id, items, transfer.items);

    const payload = buildTransferNFePayload(input);

    // #499: validação estruturada pré-transmissão
    if (await this.blockIfInvalid(fiscalDoc.id, ref, payload)) return;

    const response = await this.client.emitNFe(ref, payload);
    await this.applyFocusResponse(fiscalDoc.id, response);
  }

  // ─── Cancelamento de NF-e (#164) ──────────────────────────────────────────

  async cancel(id: string, companyId: string, justificativa: string): Promise<void> {
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id, companyId },
    });

    if (!doc) throw new NotFoundException(`Documento fiscal ${id} não encontrado`);

    if (doc.status !== FiscalStatus.AUTHORIZED) {
      throw new BadRequestException(
        `Somente documentos AUTHORIZED podem ser cancelados. Status atual: ${doc.status}`,
      );
    }

    // Validar prazo de 24h
    const hoursElapsed = (Date.now() - doc.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursElapsed > CANCEL_DEADLINE_HOURS) {
      throw new UnprocessableEntityException(
        `Prazo de ${CANCEL_DEADLINE_HOURS}h para cancelamento expirado (${Math.floor(hoursElapsed)}h desde a emissão). Use Carta de Correção.`,
      );
    }

    // Chamar Focus NFe para cancelamento
    const response = await this.client.cancelNFe(doc.focusRef, justificativa);

    if (response.status === 'cancelado') {
      await this.prisma.fiscalDocument.update({
        where: { id },
        data: {
          status: FiscalStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationJustification: justificativa,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          companyId,
          entity: 'FiscalDocument',
          action: 'CANCEL',
          payload: { fiscalDocumentId: id, justificativa },
        },
      });

      // Emitir evento para reversão de estoque e financeiro
      this.eventEmitter.emit(
        FISCAL_CANCELLED_EVENT,
        new FiscalCancelledEvent(companyId, id, doc.salesOrderId, doc.storeTransferId),
      );

      this.logger.log(`NF-e ${id} cancelada com sucesso`);
    } else {
      // Rejeição do cancelamento pela SEFAZ
      await this.prisma.fiscalDocument.update({
        where: { id },
        data: {
          lastError: response.motivo ?? 'Erro ao cancelar na SEFAZ',
        },
      });

      throw new BadRequestException(
        `Cancelamento rejeitado pela SEFAZ: ${response.motivo ?? 'erro desconhecido'}`,
      );
    }
  }

  // ─── CC-e — Carta de Correção (#165) ──────────────────────────────────────

  async correction(id: string, companyId: string, correcao: string): Promise<{ sequenceNumber: number; protocol?: string }> {
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id, companyId },
      include: { corrections: { orderBy: { sequenceNumber: 'desc' }, take: 1 } },
    });

    if (!doc) throw new NotFoundException(`Documento fiscal ${id} não encontrado`);

    if (doc.status === FiscalStatus.CANCELLED) {
      throw new UnprocessableEntityException('Não é possível emitir CC-e para documento cancelado');
    }
    if (doc.status !== FiscalStatus.AUTHORIZED) {
      throw new BadRequestException(`CC-e só pode ser emitida para documentos AUTHORIZED. Status atual: ${doc.status}`);
    }

    const lastSeq = doc.corrections[0]?.sequenceNumber ?? 0;
    if (lastSeq >= 20) {
      throw new UnprocessableEntityException('Limite de 20 CC-e por documento atingido (regra SEFAZ)');
    }

    const sequenceNumber = lastSeq + 1;
    const response = await this.client.sendCCe(doc.focusRef, correcao);

    const protocol = response.status === 'autorizado' ? (response.chave_nfe ?? response.ref ?? null) : null;

    if (response.status === 'autorizado' || response.status === 'processando_autorizacao') {
      const correction = await this.prisma.fiscalCorrection.create({
        data: { fiscalDocumentId: id, sequenceNumber, correctionText: correcao, protocol },
      });

      await this.prisma.auditLog.create({
        data: {
          companyId,
          entity: 'FiscalCorrection',
          action: 'CCE',
          payload: { fiscalDocumentId: id, sequenceNumber, correctionId: correction.id },
        },
      });

      return { sequenceNumber, protocol: protocol ?? undefined };
    }

    throw new BadRequestException(`CC-e rejeitada pela SEFAZ: ${response.motivo ?? 'erro desconhecido'}`);
  }

  // ─── Inutilização (#165) ────────────────────────────────────────────────

  async voidRange(companyId: string, serie: string, numberStart: number, numberEnd: number, justificativa: string): Promise<{ protocol?: string }> {
    if (numberEnd < numberStart) {
      throw new BadRequestException('Número final deve ser >= número inicial');
    }

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa não encontrada');

    const response = await this.client.voidRange({
      cnpj: company.cnpj.replace(/\D/g, ''),
      serie,
      numero_inicial: numberStart,
      numero_final: numberEnd,
      justificativa,
    });

    const protocol = response.status === 'autorizado' ? (response.chave_nfe ?? response.ref ?? null) : null;

    if (response.status === 'autorizado' || response.status === 'processando_autorizacao') {
      await this.prisma.fiscalVoidRange.create({
        data: {
          companyId,
          serie,
          numberStart,
          numberEnd,
          justification: justificativa,
          protocol,
          year: new Date().getFullYear(),
        },
      });

      await this.prisma.auditLog.create({
        data: {
          companyId,
          entity: 'FiscalVoidRange',
          action: 'VOID',
          payload: { serie, numberStart, numberEnd },
        },
      });

      return { protocol: protocol ?? undefined };
    }

    throw new BadRequestException(`Inutilização rejeitada pela SEFAZ: ${response.motivo ?? 'erro desconhecido'}`);
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  async findAll(companyId: string) {
    return this.prisma.fiscalDocument.findMany({
      where: { companyId },
      include: { salesOrder: { include: { customer: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id, companyId },
      include: { salesOrder: { include: { items: { include: { product: true } }, customer: true } } },
    });
    if (!doc) throw new NotFoundException(`Documento fiscal ${id} não encontrado`);
    return doc;
  }

  // ─── Exportação de XMLs para o contador (#482) ────────────────────────────

  /**
   * XMLs do período para o ZIP mensal do contador. Inclui canceladas (o
   * contador precisa delas para a escrituração). O webhook da Focus entrega
   * só o CAMINHO do XML (não o conteúdo) — documentos sem xml no banco são
   * baixados da Focus sob demanda e cacheados para as próximas exportações.
   */
  async listXmlsForExport(companyId: string, from: Date, to: Date, type?: FiscalDocumentType) {
    const docs = await this.prisma.fiscalDocument.findMany({
      where: {
        companyId,
        status: { in: [FiscalStatus.AUTHORIZED, FiscalStatus.CANCELLED] },
        ...(type && { type }),
        // autorizada no período; docs antigos sem authorizedAt caem no createdAt
        OR: [
          { authorizedAt: { gte: from, lte: to } },
          { authorizedAt: null, createdAt: { gte: from, lte: to } },
        ],
      },
      select: { id: true, chave: true, xml: true, xmlUrl: true, status: true, focusRef: true, number: true, type: true },
      orderBy: { authorizedAt: 'asc' },
    });

    const out: Array<{ name: string; xml: string }> = [];
    for (const d of docs) {
      const xml = d.xml ?? (await this.fetchAndCacheXml(d));
      if (!xml) {
        this.logger.warn(`Exportação: XML indisponível para doc ${d.id} (ref ${d.focusRef}) — pulado`);
        continue;
      }
      out.push({
        // nome padrão de mercado: <chave>-nfe.xml; sem chave usa a ref interna
        name: `${d.chave ?? d.focusRef ?? `doc-${d.number}`}-nfe${d.status === FiscalStatus.CANCELLED ? '-cancelada' : ''}.xml`,
        xml,
      });
    }
    return out;
  }

  /** Baixa o XML da Focus (via xmlUrl, ou consultando o status pela ref) e persiste como cache (#482) */
  private async fetchAndCacheXml(d: {
    id: string;
    focusRef: string | null;
    type: FiscalDocumentType;
    xmlUrl: string | null;
  }): Promise<string | null> {
    let xmlUrl = d.xmlUrl;
    let danfeUrl: string | undefined;

    if (!xmlUrl && d.focusRef) {
      const st = await this.client.getStatus(d.type === FiscalDocumentType.NFCE ? 'nfce' : 'nfe', d.focusRef);
      if (st.caminho_xml_nota_fiscal) xmlUrl = this.client.absoluteUrl(st.caminho_xml_nota_fiscal);
      if (st.caminho_danfe) danfeUrl = this.client.absoluteUrl(st.caminho_danfe);
    }
    if (!xmlUrl) return null;

    const xml = await this.client.downloadFile(xmlUrl);
    if (!xml) return null;

    await this.prisma.fiscalDocument.update({
      where: { id: d.id },
      data: { xml, xmlUrl, ...(danfeUrl && { danfeUrl }) },
    });
    return xml;
  }

  // ─── Privado: grupo transp da NF-e a partir da OV (#481) ─────────────────

  /**
   * Monta o FiscalFreight da OV. Sem modalidade cadastrada (ou 9) → undefined,
   * e o mapper emite modalidade_frete 9 como antes. Pesos dos volumes vêm de
   * Product.pesoLiquido/pesoBruto × quantidade (#484); volumes só entram
   * quando há peso ou quantidade explícita.
   */
  private buildFreight(order: {
    freightModality: string | null;
    freightValue: unknown;
    volumesQuantity: number | null;
    volumesSpecies: string | null;
    carrier: {
      razaoSocial: string | null;
      name: string;
      document: string | null;
      ie: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      vehiclePlate: string | null;
      vehiclePlateState: string | null;
      rntc: string | null;
    } | null;
    items: Array<{ quantity: unknown; product: { pesoLiquido: unknown; pesoBruto: unknown } }>;
  }) {
    if (!order.freightModality || order.freightModality === '9') return undefined;

    const pesoLiquido = order.items.reduce(
      (s, i) => s + Number(i.product.pesoLiquido ?? 0) * Number(i.quantity),
      0,
    );
    const pesoBruto = order.items.reduce(
      (s, i) => s + Number(i.product.pesoBruto ?? 0) * Number(i.quantity),
      0,
    );
    // qVol: explícito na OV, senão 1 volume por unidade vendida (reboque = volume)
    const quantidade =
      order.volumesQuantity ?? order.items.reduce((s, i) => s + Number(i.quantity), 0);

    return {
      modality: order.freightModality,
      value: order.freightValue != null ? Number(order.freightValue) : undefined,
      carrier: order.carrier
        ? {
            document: order.carrier.document ?? undefined,
            name: order.carrier.razaoSocial ?? order.carrier.name,
            ie: order.carrier.ie ?? undefined,
            address: order.carrier.address ?? undefined,
            city: order.carrier.city ?? undefined,
            state: order.carrier.state ?? undefined,
          }
        : undefined,
      vehiclePlate: order.carrier?.vehiclePlate ?? undefined,
      vehiclePlateState: order.carrier?.vehiclePlateState ?? undefined,
      rntc: order.carrier?.rntc ?? undefined,
      volumes:
        quantidade > 0
          ? [
              {
                quantidade,
                especie: order.volumesSpecies ?? undefined,
                pesoLiquido: pesoLiquido > 0 ? pesoLiquido : undefined,
                pesoBruto: pesoBruto > 0 ? pesoBruto : undefined,
              },
            ]
          : undefined,
    };
  }

  // ─── Privado: persiste itens + impostos detalhados (#166) ────────────────

  private async persistFiscalItems(
    fiscalDocumentId: string,
    fiscalItems: FiscalItem[],
    orderItems: Array<{ product: any; quantity: any; unitPrice?: any; unit?: any }>,
  ): Promise<void> {
    for (let i = 0; i < fiscalItems.length; i++) {
      const fi = fiscalItems[i];
      const oi = orderItems[i];
      const totalPrice = Number(fi.quantity) * Number(fi.unitPrice);

      const docItem = await this.prisma.fiscalDocumentItem.create({
        data: {
          fiscalDocumentId,
          productId: oi?.product?.id ?? null,
          productCode: fi.sku,
          productName: fi.name,
          ncm: fi.ncm,
          cfop: fi.tax?.cfop ?? null,
          unit: fi.unit,
          quantity: fi.quantity,
          unitPrice: fi.unitPrice,
          totalPrice,
        },
      });

      if (fi.tax) {
        await this.prisma.fiscalDocumentItemTax.create({
          data: {
            fiscalDocumentItemId: docItem.id,
            cstIcms: fi.tax.icmsCst,
            baseIcms: fi.tax.icmsBase,
            aliquotaIcms: fi.tax.icmsAliquota,
            valorIcms: fi.tax.icmsValor,
            cstIpi: fi.tax.ipiCst,
            baseIpi: fi.tax.ipiBase,
            aliquotaIpi: fi.tax.ipiAliquota,
            valorIpi: fi.tax.ipiValor,
            cstPis: fi.tax.pisCst,
            basePis: fi.tax.pisBase,
            aliquotaPis: fi.tax.pisAliquota,
            valorPis: fi.tax.pisValor,
            cstCofins: fi.tax.cofinsCst,
            baseCofins: fi.tax.cofinsBase,
            aliquotaCofins: fi.tax.cofinsAliquota,
            valorCofins: fi.tax.cofinsValor,
            ...(fi.tax.difal && {
              difalBase: fi.tax.difal.baseCalculo,
              difalAliqInterna: fi.tax.difal.aliquotaInterna,
              difalAliqInterest: fi.tax.difal.aliquotaInterestadual,
              difalValor: fi.tax.difal.valor,
              difalFcpAliquota: fi.tax.difal.fcpAliquota ?? 0,
              difalFcpValor: fi.tax.difal.fcpValor ?? 0,
            }),
            ...(fi.tax.ibsCbs && {
              cClassTrib: fi.tax.ibsCbs.cClassTrib,
              cIndOp: '0',
              cstCbs: fi.tax.ibsCbs.cbsCst,
              baseCbs: fi.tax.ibsCbs.base,
              aliquotaCbs: fi.tax.ibsCbs.cbsAliquota,
              valorCbs: fi.tax.ibsCbs.cbsValor,
              cstIbsUf: fi.tax.ibsCbs.cbsCst,
              baseIbsUf: fi.tax.ibsCbs.base,
              aliquotaIbsUf: fi.tax.ibsCbs.ibsUfAliquota,
              valorIbsUf: fi.tax.ibsCbs.ibsUfValor,
              cstIbsMun: fi.tax.ibsCbs.cbsCst,
              baseIbsMun: fi.tax.ibsCbs.base,
              aliquotaIbsMun: fi.tax.ibsCbs.ibsMunAliquota,
              valorIbsMun: fi.tax.ibsCbs.ibsMunValor,
            }),
          },
        });
      }
    }
  }

  // ─── Privado: aplica resposta da Focus ───────────────────────────────────

  private async applyFocusResponse(
    fiscalDocId: string,
    response: {
      status: string;
      chave_nfe?: string;
      xml?: string;
      motivo?: string;
      codigo?: string;
      numero?: string | number;
      serie?: string | number;
      protocolo?: string;
      caminho_danfe?: string; // path do PDF do DANFE na Focus (#482)
      caminho_xml_nota_fiscal?: string; // path do XML autorizado na Focus (#482)
    },
  ): Promise<void> {
    const statusMap: Record<string, FiscalStatus> = {
      autorizado: FiscalStatus.AUTHORIZED,
      processando_autorizacao: FiscalStatus.PROCESSING,
      rejeitado: FiscalStatus.REJECTED,
      cancelado: FiscalStatus.CANCELLED,
      erro: FiscalStatus.ERROR,
    };

    const newStatus = statusMap[response.status] ?? FiscalStatus.ERROR;

    // Número/série/protocolo SEFAZ (#361) — Focus retorna numero/serie no response;
    // nProt pode vir no campo protocolo ou embutido no XML autorizado
    const number = response.numero != null ? Number(response.numero) : null;
    const series = response.serie != null ? Number(response.serie) : null;
    const protocolNumber =
      response.protocolo ?? response.xml?.match(/<nProt>(\d+)<\/nProt>/)?.[1] ?? null;

    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDocId },
      data: {
        status: newStatus,
        chave: response.chave_nfe ?? null,
        xml: response.xml ?? null,
        ...(number != null && { number }),
        ...(series != null && { series }),
        ...(protocolNumber && { protocolNumber }),
        // URLs absolutas — o caminho da Focus é relativo ao ambiente (prod/homolog) (#482)
        ...(response.caminho_danfe && { danfeUrl: this.client.absoluteUrl(response.caminho_danfe) }),
        ...(response.caminho_xml_nota_fiscal && { xmlUrl: this.client.absoluteUrl(response.caminho_xml_nota_fiscal) }),
        ...(newStatus === FiscalStatus.AUTHORIZED && { authorizedAt: new Date() }),
        ...(newStatus === FiscalStatus.CANCELLED && { cancelledAt: new Date() }),
        rejectionCode: response.codigo ?? null,
        rejectionReason: newStatus === FiscalStatus.REJECTED ? (response.motivo ?? null) : null,
        lastError: newStatus === FiscalStatus.ERROR ? (response.motivo ?? null) : null,
      },
    });

    this.logger.log(`FiscalDocument ${fiscalDocId} → ${newStatus}`);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** PaymentMethod → código tPag da NF-e (tabela 4.3.4.1) (#479/#584) */
const NFE_PAYMENT_CODES: Record<PaymentMethod, string> = {
  DINHEIRO: '01',
  CHEQUE: '02',
  CARTAO: '03', // legado — granularidade abaixo (#584)
  CARTAO_CREDITO: '03',
  CARTAO_DEBITO: '04',
  BOLETO: '15',
  PIX: '17',
  TED: '18',
};
