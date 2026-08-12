import { BadRequestException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FiscalDocumentType, FiscalFinalidade, FiscalStatus, PaymentMethod, TaxOperationType } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EMISSOR_PORT, EmissorPort } from './emissor.port';
import { formatValidationIssues, validateNfePayload } from './fiscal-validator';
import { TaxCalculationService } from '../tax/tax-calculation.service';
import { FISCAL_CANCELLED_EVENT, FiscalCancelledEvent } from './events/fiscal-cancelled.event';
import { FISCAL_AUTHORIZED_EVENT, FiscalAuthorizedEvent } from './events/fiscal-authorized.event';
import {
  buildAdjustmentNFePayload,
  buildItemDescription,
  buildNFCePayload,
  buildNFePayload,
  buildTransferNFePayload,
  calcTotalValue,
  FiscalAdjustmentPayloadItem,
  FiscalItem,
  FiscalPayloadInput,
  FiscalVehicleData,
  cardBrandCode,
} from './fiscal-mapper';
import { AdjustmentSpec, IbsCbsAdjustmentService } from './ibscbs-adjustment.service';

const CANCEL_DEADLINE_HOURS = 24;

@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMISSOR_PORT) private readonly client: EmissorPort,
    private readonly taxCalc: TaxCalculationService,
    private readonly eventEmitter: EventEmitter2,
    private readonly ibsCbsAdjustment: IbsCbsAdjustmentService,
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
        vehicle = this.buildVehicleData(sn, i.product);

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
          // Simples Nacional (#1069) — só vem preenchido se a regra tiver CSOSN
          ...(taxResult.icms.csosn && {
            icmsCsosn: taxResult.icms.csosn,
            icmsCredSNAliquota: taxResult.icms.credSNAliquota,
            icmsCredSNValor: taxResult.icms.credSNValor,
          }),
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

    // Veículo: descrição completa p/ DETRAN/despachante (formato definido pelo
    // Claudio 13/07, espelho das notas do sistema anterior). Campos dinâmicos
    // do SerialNumber; venda p/ RS exige declarar pneus novos.
    for (const it of items) {
      if (it.vehicle) {
        infCplParts.push(
          vehicleInfCpl(it.vehicle, order.customer?.state ?? undefined),
        );
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
    const model = type === FiscalDocumentType.NFE ? ('nfe' as const) : ('nfce' as const);
    if (await this.blockIfInvalid(fiscalDoc.id, ref, payload, model)) return;

    // Enviar para Focus NFe
    const response =
      type === FiscalDocumentType.NFE
        ? await this.client.emitNFe(ref, payload, fiscalDoc.companyId)
        : await this.client.emitNFCe(ref, payload, fiscalDoc.companyId);

    // Processar resposta e atualizar status
    await this.applyFocusResponse(fiscalDoc.id, response);
  }

  /** Grupo veicProd a partir do SerialNumber (extraído p/ venda E devolução — #747) */
  private buildVehicleData(sn: any, product: any): FiscalVehicleData {
    return {
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
      codigoMarcaModelo: sn.codigoMarcaModelo ?? product?.codigoMarcaModelo ?? '999999',
      corDenatran: sn.corDenatran ?? '00',
      lotacao: sn.lotacao ?? 0,
      restricao: sn.restricao ?? '0',
      qtdEixos: sn.qtdEixos,
    };
  }

  // ─── #747: NF-e de DEVOLUÇÃO (entrada, finNFe 4) referenciando a original ──

  /**
   * Emite a NF-e de devolução da venda: nota de ENTRADA (tipo_documento 0,
   * finalidade 4, CFOP 1202/2202) que ESPELHA os tributos persistidos da NF-e
   * original (FiscalDocumentItem/ItemTax) — devolução estorna o que foi
   * destacado na original; recalcular com regras vigentes poderia divergir
   * (vigência #500). Formato validado na SEFAZ em 16/07 (notas 20004/20005,
   * incl. veicProd preservado). O vínculo com a OV vai por referencedDocumentId
   * (salesOrderId fica NULL — o @unique é da nota NORMAL da OV).
   */
  async emitReturnNote(originalDocumentId: string, companyId: string, reason?: string): Promise<void> {
    const original = await this.prisma.fiscalDocument.findFirst({
      where: { id: originalDocumentId, companyId },
      include: {
        items: { include: { taxes: true }, orderBy: { id: 'asc' } },
        salesOrder: {
          include: {
            company: true,
            customer: true,
            items: { include: { product: true, serialNumber: true } },
          },
        },
      },
    });

    if (!original) throw new NotFoundException(`Documento fiscal ${originalDocumentId} não encontrado`);
    if (original.type !== FiscalDocumentType.NFE) {
      throw new BadRequestException(
        'Devolução referenciada só é suportada para NF-e (mod 55). Venda NFC-e: fluxo pendente (#747).',
      );
    }
    if (original.status !== FiscalStatus.AUTHORIZED || !original.chave) {
      throw new BadRequestException(
        `Somente NF-e AUTHORIZED (com chave) pode ser devolvida. Status atual: ${original.status}`,
      );
    }
    if (original.finalidade !== FiscalFinalidade.NORMAL) {
      throw new BadRequestException('Devolução referencia apenas a NF-e de venda (finalidade NORMAL).');
    }
    const order = original.salesOrder as any;
    if (!order) throw new BadRequestException('NF-e sem OV vinculada — devolução deve ser tratada manualmente.');
    if (order.status !== 'RETURNED') {
      throw new BadRequestException(
        'A OV precisa estar RETURNED (devolução interna executada) antes da NF-e de devolução.',
      );
    }
    if (!original.items?.length || original.items.some((it: any) => !it.taxes?.length)) {
      throw new BadRequestException(
        'NF-e original sem itens/impostos persistidos — emitir devolução manualmente (docs pré-#166).',
      );
    }

    // Idempotência: uma devolução viva por NF-e original
    const existing = await this.prisma.fiscalDocument.findFirst({
      where: { referencedDocumentId: original.id, finalidade: FiscalFinalidade.DEVOLUCAO },
    });
    if (existing && existing.status !== FiscalStatus.REJECTED && existing.status !== FiscalStatus.ERROR) {
      this.logger.warn(`Devolução já existe para NF-e ${original.id}: status=${existing.status}`);
      return;
    }

    const ref = `GDR-RET-${original.id}`;
    const fiscalDoc = existing
      ? await this.prisma.fiscalDocument.update({
          where: { id: existing.id },
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
            companyId,
            type: FiscalDocumentType.NFE,
            finalidade: FiscalFinalidade.DEVOLUCAO,
            referencedDocumentId: original.id,
            status: FiscalStatus.PENDING,
            focusRef: ref,
          },
        });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'FiscalDocument',
        action: 'EMIT_RETURN',
        payload: { fiscalDocumentId: fiscalDoc.id, referencedDocumentId: original.id, reason: reason ?? null },
      },
    });

    // Espelho dos itens persistidos da original. Pareamento com o item da OV:
    // 1º pelo CHASSI persistido no productName ("... - CHASSI X" — #733), 2º por
    // SKU quando único, 3º por índice. Índice puro trocaria chassi entre itens
    // do mesmo modelo (ordem do banco não é garantida).
    const isInterstate = order.customer?.state && order.company.state !== order.customer.state;
    const returnCfop = isInterstate ? '2202' : '1202';
    const orderItems: any[] = order.items ?? [];
    const pairOrderItem = (it: any, idx: number): any => {
      const m = /- CHASSI (\S+)$/.exec(it.productName ?? '');
      if (m) {
        const byChassi = orderItems.find((o) => o.serialNumber?.chassi === m[1]);
        if (byChassi) return byChassi;
      }
      const bySku = orderItems.filter((o) => o.product?.sku === it.productCode);
      if (bySku.length === 1) return bySku[0];
      return orderItems[idx];
    };

    const paired: any[] = original.items.map((it: any, idx: number) => pairOrderItem(it, idx));

    const items: FiscalItem[] = original.items.map((it: any, idx: number) => {
      const t = it.taxes?.[0];
      const oi = paired[idx];
      const sn = oi?.serialNumber;
      const num = (v: any): number | undefined => (v == null ? undefined : Number(v));
      return {
        sku: it.productCode ?? oi?.product?.sku ?? 'ITEM',
        // nome CRU do produto — o persistido já tem "- CHASSI" (buildItemDescription re-anexa)
        name: oi?.product?.name ?? it.productName,
        ncm: it.ncm ?? '00000000',
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        unit: it.unit ?? oi?.product?.unit,
        origem: oi?.product?.origem,
        ean: oi?.product?.ean ?? undefined,
        cest: it.cest ?? undefined,
        tax: {
          cfop: returnCfop,
          // ⚠️ LIMITE CONHECIDO (#1069): esta é a devolução, que reemite a partir
          // do ItemTax PERSISTIDO — e ItemTax não tem coluna de CSOSN. Para
          // emitente do Simples (CRT=1/2) a devolução ainda sai com CST e será
          // rejeitada. Persistir o CSOSN no ItemTax é trabalho à parte; não há
          // nota de Simples emitida ainda, então isso não bloqueia o go-live.
          icmsCst: t.cstIcms ?? '00',
          icmsBase: num(t.baseIcms) ?? 0,
          icmsAliquota: num(t.aliquotaIcms) ?? 0,
          icmsValor: num(t.valorIcms) ?? 0,
          ipiCst: t.cstIpi ?? '53',
          ipiBase: num(t.baseIpi) ?? 0,
          ipiAliquota: num(t.aliquotaIpi) ?? 0,
          ipiValor: num(t.valorIpi) ?? 0,
          pisCst: t.cstPis ?? '49',
          pisBase: num(t.basePis) ?? 0,
          pisAliquota: num(t.aliquotaPis) ?? 0,
          pisValor: num(t.valorPis) ?? 0,
          cofinsCst: t.cstCofins ?? '99',
          cofinsBase: num(t.baseCofins) ?? 0,
          cofinsAliquota: num(t.aliquotaCofins) ?? 0,
          cofinsValor: num(t.valorCofins) ?? 0,
          // DIFAL NÃO espelha: é apuração do emitente na venda, não compõe a entrada
          ...(t.cClassTrib && {
            ibsCbs: {
              cClassTrib: t.cClassTrib,
              cbsCst: t.cstCbs ?? '000',
              base: num(t.baseCbs) ?? 0,
              cbsAliquota: num(t.aliquotaCbs) ?? 0,
              cbsValor: num(t.valorCbs) ?? 0,
              ibsUfAliquota: num(t.aliquotaIbsUf) ?? 0,
              ibsUfValor: num(t.valorIbsUf) ?? 0,
              ibsMunAliquota: num(t.aliquotaIbsMun) ?? 0,
              ibsMunValor: num(t.valorIbsMun) ?? 0,
            },
          }),
        },
        // Devolução veicular MANTÉM o veicProd (validado SEFAZ homolog 16/07)
        vehicle: sn?.chassi ? this.buildVehicleData(sn, oi?.product) : undefined,
      };
    });

    const totalValue = calcTotalValue(items);
    const recipientDoc = order.customer?.document?.replace(/\D/g, '') ?? '';
    const consumidorFinal = order.customer?.indIeDest
      ? order.customer.indIeDest !== 'CONTRIBUINTE'
      : !order.customer?.ie || recipientDoc.length === 11;

    const infCpl =
      `DEVOLUCAO DE VENDA REF NF-E ${original.number ?? ''} SERIE ${original.series ?? 1}` +
      (reason ? `. MOTIVO: ${reason}` : '');

    const input: FiscalPayloadInput = {
      ref,
      finalidade: '4',
      tipoDocumento: '0',
      naturezaOperacao: 'DEVOLUCAO DE VENDA',
      referencedKeys: [original.chave],
      paymentMethod: '90', // devolução exige "90 - sem pagamento" valor 0 (rej. 871)
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
      items,
      totalValue,
      consumidorFinal,
      infCpl,
      // sem delivery/freight: devolução entra no estabelecimento (modalidade 9)
    };

    await this.persistFiscalItems(fiscalDoc.id, items, paired);

    const vIBS = round2(
      items.reduce((s, it) => s + (it.tax?.ibsCbs ? it.tax.ibsCbs.ibsUfValor + it.tax.ibsCbs.ibsMunValor : 0), 0),
    );
    const vCBS = round2(items.reduce((s, it) => s + (it.tax?.ibsCbs?.cbsValor ?? 0), 0));
    const hasIbsCbs = items.some((it) => it.tax?.ibsCbs);
    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDoc.id },
      data: {
        infCpl,
        ...(hasIbsCbs && { vIBS, vCBS, vCredPres: 0, vCredPresCondSus: 0, vIBSMono: 0, vCBSMono: 0 }),
      },
    });

    const payload = buildNFePayload(input);
    if (await this.blockIfInvalid(fiscalDoc.id, ref, payload, 'nfe')) return;

    const response = await this.client.emitNFe(ref, payload, companyId);
    await this.applyFocusResponse(fiscalDoc.id, response);
  }

  // ─── #757: Nota de Débito/Crédito IBS/CBS (finNFe 5/6, épico #753) ─────────

  /** Motivos válidos por espécie (tpNFDebito 01-08 / tpNFCredito 01-06, SINIEF 49/2025) */
  private static readonly ADJUSTMENT_TIPOS: Record<'DEBITO' | 'CREDITO', string[]> = {
    DEBITO: ['01', '02', '03', '04', '05', '06', '07', '08'],
    CREDITO: ['01', '02', '03', '04', '05', '06'],
  };

  /**
   * Emite Nota de Débito (finNFe 6) ou de Crédito (finNFe 5) referenciando a
   * NF-e original. Os valores vêm do motor de diferença (#755) — espelho das
   * alíquotas efetivas persistidas da original; SÓ IBS/CBS (regra da Reforma).
   * Múltiplos ajustes na mesma original são legítimos (ex.: multa mensal) —
   * bloqueia apenas ajuste simultâneo em PENDING/PROCESSING; REJECTED/ERROR é
   * reaproveitado (retry). ⚠️ NÃO usar em produção antes da homologação F4
   * (#760): tipo_documento/CFOP das notas 5/6 ainda serão confirmados na SEFAZ.
   */
  async emitAdjustmentNote(
    originalDocumentId: string,
    companyId: string,
    kind: 'DEBITO' | 'CREDITO',
    dto: { tipo: string; spec: AdjustmentSpec; justificativa?: string },
  ): Promise<void> {
    if (!FiscalService.ADJUSTMENT_TIPOS[kind].includes(dto.tipo)) {
      throw new BadRequestException(
        `Motivo "${dto.tipo}" inválido para nota de ${kind.toLowerCase()} — use ${FiscalService.ADJUSTMENT_TIPOS[kind].join(', ')}.`,
      );
    }
    // SEFAZ-PR homolog (F4 #760): finNFe 5 + retorno/recusa cai em conflito de
    // regras 327↔328 (todo CFOP é rejeitado). O caso real é coberto pela NF-e
    // de DEVOLUÇÃO (finNFe 4, POST /fiscal/:id/return-note). Sentinela G3 do
    // audit-homologacao detecta quando a SEFAZ corrigir.
    if (kind === 'CREDITO' && ['03', '06'].includes(dto.tipo)) {
      throw new BadRequestException(
        'Retorno/recusa na entrega (motivos 03/06) está com regras conflitantes na SEFAZ (rej. 327↔328) — ' +
          'use a NF-e de devolução (finalidade 4) para este caso.',
      );
    }

    const original = await this.prisma.fiscalDocument.findFirst({
      where: { id: originalDocumentId, companyId },
      include: {
        items: { include: { taxes: true }, orderBy: { id: 'asc' } },
        salesOrder: { include: { company: true, customer: true } },
      },
    });

    if (!original) throw new NotFoundException(`Documento fiscal ${originalDocumentId} não encontrado`);
    if (original.type !== FiscalDocumentType.NFE) {
      throw new BadRequestException('Nota de débito/crédito só referencia NF-e (mod 55).');
    }
    if (original.status !== FiscalStatus.AUTHORIZED || !original.chave) {
      throw new BadRequestException(
        `Somente NF-e AUTHORIZED (com chave) pode ser ajustada. Status atual: ${original.status}`,
      );
    }
    if (original.finalidade !== FiscalFinalidade.NORMAL) {
      throw new BadRequestException('Nota de débito/crédito referencia apenas a NF-e de venda (finalidade NORMAL).');
    }
    const order = original.salesOrder as any;
    if (!order?.company) {
      throw new BadRequestException('NF-e original sem OV/emitente vinculado — ajuste manual.');
    }
    if (!original.items?.length || original.items.some((it: any) => !it.taxes?.length)) {
      throw new BadRequestException('NF-e original sem itens/impostos persistidos — ajuste manual (docs pré-#166).');
    }

    // Ajuste simultâneo bloqueado; REJECTED/ERROR do mesmo motivo é reaproveitado
    const finalidade = kind === 'DEBITO' ? FiscalFinalidade.NOTA_DEBITO : FiscalFinalidade.NOTA_CREDITO;
    const siblings = await this.prisma.fiscalDocument.findMany({
      where: { referencedDocumentId: original.id, finalidade },
    });
    const inFlight = siblings.find(
      (s) => s.status === FiscalStatus.PENDING || s.status === FiscalStatus.PROCESSING,
    );
    if (inFlight) {
      throw new BadRequestException(
        `Já existe nota de ${kind.toLowerCase()} em processamento para esta NF-e (doc ${inFlight.id}) — aguarde o retorno da SEFAZ.`,
      );
    }
    const tipoField = kind === 'DEBITO' ? 'tipoNotaDebito' : 'tipoNotaCredito';
    const reusable = siblings.find(
      (s) =>
        (s.status === FiscalStatus.REJECTED || s.status === FiscalStatus.ERROR) &&
        (s as any)[tipoField] === dto.tipo,
    );

    // Motor de diferença (#755) sobre os impostos persistidos da original
    const result = this.ibsCbsAdjustment.compute(
      original.items.map((it: any) => {
        const t = it.taxes[0];
        const num = (v: any): number => (v == null ? 0 : Number(v));
        return {
          id: it.id,
          sku: it.productCode ?? 'ITEM',
          name: it.productName,
          ncm: it.ncm,
          tax: {
            cClassTrib: t.cClassTrib,
            cstCbs: t.cstCbs,
            baseCbs: num(t.baseCbs),
            valorCbs: num(t.valorCbs),
            baseIbsUf: num(t.baseIbsUf),
            valorIbsUf: num(t.valorIbsUf),
            baseIbsMun: num(t.baseIbsMun),
            valorIbsMun: num(t.valorIbsMun),
          },
        };
      }),
      dto.spec,
    );

    const ref = reusable?.focusRef ?? `GDR-ADJ-${original.id}-${siblings.length + 1}`;
    const fiscalDoc = reusable
      ? await this.prisma.fiscalDocument.update({
          where: { id: reusable.id },
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
            companyId,
            type: FiscalDocumentType.NFE,
            finalidade,
            [tipoField]: dto.tipo,
            referencedDocumentId: original.id,
            status: FiscalStatus.PENDING,
            focusRef: ref,
          },
        });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'FiscalDocument',
        action: kind === 'DEBITO' ? 'EMIT_DEBIT_NOTE' : 'EMIT_CREDIT_NOTE',
        payload: {
          fiscalDocumentId: fiscalDoc.id,
          referencedDocumentId: original.id,
          tipo: dto.tipo,
          spec: dto.spec as any,
          justificativa: dto.justificativa ?? null,
        },
      },
    });

    // Persistir itens do ajuste (só IBS/CBS) — base p/ registro fiscal e retry
    if (!reusable) {
      for (const it of result.items) {
        const docItem = await this.prisma.fiscalDocumentItem.create({
          data: {
            fiscalDocumentId: fiscalDoc.id,
            productName: it.name,
            productCode: it.sku,
            ncm: it.ncm,
            quantity: 1,
            unitPrice: it.base,
            totalPrice: it.base,
          },
        });
        await this.prisma.fiscalDocumentItemTax.create({
          data: {
            fiscalDocumentItemId: docItem.id,
            cClassTrib: it.cClassTrib,
            cstCbs: it.cstCbs,
            baseCbs: it.base,
            aliquotaCbs: it.cbsAliquota,
            valorCbs: it.cbsValor,
            cstIbsUf: it.cstCbs,
            baseIbsUf: it.base,
            aliquotaIbsUf: it.ibsUfAliquota,
            valorIbsUf: it.ibsUfValor,
            cstIbsMun: it.cstCbs,
            baseIbsMun: it.base,
            aliquotaIbsMun: it.ibsMunAliquota,
            valorIbsMun: it.ibsMunValor,
          },
        });
      }
    }

    const infCpl =
      `NOTA DE ${kind} IBS/CBS (SINIEF 49/2025) REF NF-E ${original.number ?? ''} SERIE ${original.series ?? 1}` +
      (dto.justificativa ? `. ${dto.justificativa.toUpperCase()}` : '');

    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDoc.id },
      data: { infCpl, vIBS: result.vIBS, vCBS: result.vCBS, vCredPres: 0, vCredPresCondSus: 0, vIBSMono: 0, vCBSMono: 0 },
    });

    const payload = buildAdjustmentNFePayload({
      ref,
      finalidade: kind === 'DEBITO' ? '6' : '5',
      tipoNota: dto.tipo,
      referencedKey: original.chave,
      emitter: this.mapCompanyToEmitter(order.company),
      recipient: order.customer ? this.mapCustomerToRecipient(order.customer) : undefined,
      // gDFeReferenciado por item (rej. 1038): nItem do item correspondente na
      // original; item sintético (AMOUNT) referencia o item 1
      items: result.items.map((it) =>
        this.toAdjustmentPayloadItem(
          it,
          it.sourceItemId ? original.items.findIndex((oi: any) => oi.id === it.sourceItemId) + 1 : 1,
        ),
      ),
      infCpl,
    });

    if (await this.blockIfInvalid(fiscalDoc.id, ref, payload, 'nfe')) return;

    const response = await this.client.emitNFe(ref, payload, companyId);
    await this.applyFocusResponse(fiscalDoc.id, response);
  }

  /** Retry de nota de débito/crédito: re-monta o payload dos itens persistidos do próprio ajuste */
  private async retryAdjustment(doc: { id: string; companyId: string }): Promise<void> {
    const adj = await this.prisma.fiscalDocument.findFirst({
      where: { id: doc.id, companyId: doc.companyId },
      include: {
        items: { include: { taxes: true }, orderBy: { id: 'asc' } },
        referencedDocument: {
          include: {
            items: { orderBy: { id: 'asc' } }, // p/ recompor o nItem do gDFeReferenciado
            salesOrder: { include: { company: true, customer: true } },
          },
        },
      },
    });
    if (!adj?.referencedDocument?.chave || !(adj.referencedDocument as any).salesOrder?.company) {
      throw new BadRequestException('Ajuste sem NF-e original/emitente vinculado — reprocessamento manual.');
    }
    const order = (adj.referencedDocument as any).salesOrder;

    await this.prisma.fiscalDocument.update({
      where: { id: adj.id },
      data: { status: FiscalStatus.PENDING, retryCount: { increment: 1 }, lastError: null, rejectionCode: null, rejectionReason: null },
    });

    const kind = adj.finalidade === FiscalFinalidade.NOTA_DEBITO ? ('6' as const) : ('5' as const);
    const num = (v: any): number => (v == null ? 0 : Number(v));
    const payload = buildAdjustmentNFePayload({
      ref: adj.focusRef!,
      finalidade: kind,
      tipoNota: (kind === '6' ? adj.tipoNotaDebito : adj.tipoNotaCredito) ?? '',
      referencedKey: adj.referencedDocument.chave,
      emitter: this.mapCompanyToEmitter(order.company),
      recipient: order.customer ? this.mapCustomerToRecipient(order.customer) : undefined,
      items: adj.items.map((it: any) => {
        const t = it.taxes?.[0] ?? {};
        // nItem na original recomposto por productCode; sintético (AJUSTE) → 1
        const origIdx = ((adj.referencedDocument as any).items ?? []).findIndex(
          (oi: any) => oi.productCode && oi.productCode === it.productCode,
        );
        return {
          sku: it.productCode ?? 'AJUSTE',
          name: it.productName,
          ncm: it.ncm,
          base: num(it.totalPrice),
          cClassTrib: t.cClassTrib ?? '000001',
          cstCbs: t.cstCbs ?? '000',
          cbsAliquota: num(t.aliquotaCbs),
          cbsValor: num(t.valorCbs),
          ibsUfAliquota: num(t.aliquotaIbsUf),
          ibsUfValor: num(t.valorIbsUf),
          ibsMunAliquota: num(t.aliquotaIbsMun),
          ibsMunValor: num(t.valorIbsMun),
          referencedItemNumber: origIdx >= 0 ? origIdx + 1 : 1,
        };
      }),
      infCpl: adj.infCpl ?? undefined,
    });

    if (await this.blockIfInvalid(adj.id, adj.focusRef!, payload, 'nfe')) return;
    const response = await this.client.emitNFe(adj.focusRef!, payload, doc.companyId);
    await this.applyFocusResponse(adj.id, response);
  }

  /** Company → FiscalEmitter (mesmo mapeamento do emitForSale/emitReturnNote) */
  private mapCompanyToEmitter(company: any) {
    return {
      cnpj: company.cnpj,
      name: company.razaoSocial ?? company.name,
      ie: company.ie ?? undefined,
      crt: company.crt ?? undefined,
      address: company.street ?? 'Endereço não cadastrado',
      number: company.number ?? undefined,
      complement: company.complement ?? undefined,
      neighborhood: company.neighborhood ?? undefined,
      city: company.city ?? 'Cidade',
      state: company.state ?? 'SP',
      zipCode: company.zipCode ?? undefined,
      ibgeCode: company.ibgeCode ?? undefined,
      phone: company.phone ?? undefined,
    };
  }

  /** Customer → FiscalRecipient (mesmo mapeamento do emitForSale/emitReturnNote) */
  private mapCustomerToRecipient(customer: any) {
    return {
      name: customer.name,
      razaoSocial: customer.razaoSocial ?? undefined,
      document: customer.document ?? undefined,
      ie: customer.ie ?? undefined,
      indIeDest: customer.indIeDest ?? undefined,
      email: customer.fiscalEmail ?? customer.email ?? undefined,
      address: customer.address ?? undefined,
      number: customer.number ?? undefined,
      complement: customer.complement ?? undefined,
      neighborhood: customer.neighborhood ?? undefined,
      city: customer.city ?? undefined,
      state: customer.state ?? undefined,
      zipCode: customer.zipCode ?? undefined,
      ibgeCode: customer.ibgeCode ?? undefined,
    };
  }

  private toAdjustmentPayloadItem(
    it: {
      sku: string; name: string; ncm: string | null; base: number; cClassTrib: string; cstCbs: string;
      cbsAliquota: number; cbsValor: number; ibsUfAliquota: number; ibsUfValor: number; ibsMunAliquota: number; ibsMunValor: number;
    },
    referencedItemNumber?: number,
  ): FiscalAdjustmentPayloadItem {
    return {
      sku: it.sku,
      name: it.name,
      ncm: it.ncm,
      base: it.base,
      cClassTrib: it.cClassTrib,
      cstCbs: it.cstCbs,
      cbsAliquota: it.cbsAliquota,
      cbsValor: it.cbsValor,
      ibsUfAliquota: it.ibsUfAliquota,
      ibsUfValor: it.ibsUfValor,
      ibsMunAliquota: it.ibsMunAliquota,
      ibsMunValor: it.ibsMunValor,
      referencedItemNumber: referencedItemNumber && referencedItemNumber > 0 ? referencedItemNumber : 1,
    };
  }

  /**
   * #499 — roda o Fiscal Validator no payload flat; com problemas, marca o
   * documento ERROR com mensagem orientada e NÃO transmite. Retorna true se bloqueou.
   */
  private async blockIfInvalid(
    fiscalDocumentId: string,
    ref: string,
    payload: Record<string, unknown>,
    model: 'nfe' | 'nfce' = 'nfe',
  ): Promise<boolean> {
    const issues = validateNfePayload(payload, model);
    if (issues.length === 0) return false;
    const msg = formatValidationIssues(issues);
    this.logger.warn(`Fiscal Validator bloqueou ${ref}: ${msg}`);
    // tenant-lint: ok (fluxo interno de emissão: id do documento recém-criado pelo próprio service)
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

    // #747: devolução reprocessa pelo fluxo referenciado (salesOrderId é NULL)
    if (doc.finalidade === FiscalFinalidade.DEVOLUCAO) {
      if (!doc.referencedDocumentId) {
        throw new BadRequestException('Devolução sem vínculo à NF-e original — reprocessamento manual.');
      }
      await this.emitReturnNote(doc.referencedDocumentId, companyId);
      return;
    }

    // #757: nota de débito/crédito re-monta o payload dos itens persistidos do ajuste
    if (doc.finalidade === FiscalFinalidade.NOTA_DEBITO || doc.finalidade === FiscalFinalidade.NOTA_CREDITO) {
      await this.retryAdjustment({ id: doc.id, companyId });
      return;
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
          // Simples Nacional (#1069)
          ...(taxResult.icms.csosn && {
            icmsCsosn: taxResult.icms.csosn,
            icmsCredSNAliquota: taxResult.icms.credSNAliquota,
            icmsCredSNValor: taxResult.icms.credSNValor,
          }),
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

    const response = await this.client.emitNFe(ref, payload, fiscalDoc.companyId);
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
    const response = await this.client.cancelNFe(doc.focusRef, justificativa, companyId);

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
          // #727: protocolo/mensagem do evento de cancelamento p/ auditoria
          payload: {
            fiscalDocumentId: id,
            justificativa,
            protocolo: (response as any).protocolo ?? null,
            mensagemSefaz: (response as any).mensagem_sefaz ?? null,
          },
        },
      });

      // Emitir evento para reversão de estoque e financeiro
      this.eventEmitter.emit(
        FISCAL_CANCELLED_EVENT,
        new FiscalCancelledEvent(companyId, id, doc.salesOrderId, doc.storeTransferId),
      );

      this.logger.log(`NF-e ${id} cancelada com sucesso`);
    } else {
      // Rejeição do cancelamento pela SEFAZ (#727: capturar mensagem_sefaz/status_sefaz)
      const motivo =
        response.motivo ?? (response as any).mensagem_sefaz ?? 'Erro ao cancelar na SEFAZ';
      const codigo = (response as any).codigo ?? (response as any).status_sefaz;
      await this.prisma.fiscalDocument.update({
        where: { id },
        data: {
          lastError: codigo ? `[${codigo}] ${motivo}` : motivo,
        },
      });

      throw new BadRequestException(
        `Cancelamento rejeitado pela SEFAZ: ${codigo ? `[${codigo}] ` : ''}${motivo}`,
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
    const response = await this.client.sendCCe(doc.focusRef, correcao, companyId);

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
    }, companyId);

    // #727: o protocolo real vem em `protocolo` — chave_nfe/ref são fallbacks legados
    const protocol =
      response.status === 'autorizado'
        ? ((response as any).protocolo ?? response.chave_nfe ?? response.ref ?? null)
        : null;

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
          // #727: protocolo/mensagem da SEFAZ p/ auditoria
          payload: {
            serie,
            numberStart,
            numberEnd,
            protocolo: protocol,
            mensagemSefaz: (response as any).mensagem_sefaz ?? null,
          },
        },
      });

      return { protocol: protocol ?? undefined };
    }

    const voidMotivo = response.motivo ?? (response as any).mensagem_sefaz ?? 'erro desconhecido';
    const voidCodigo = (response as any).codigo ?? (response as any).status_sefaz;
    throw new BadRequestException(
      `Inutilização rejeitada pela SEFAZ: ${voidCodigo ? `[${voidCodigo}] ` : ''}${voidMotivo}`,
    );
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
      include: {
        salesOrder: { include: { items: { include: { product: true } }, customer: true } },
        // #758: itens/impostos persistidos (wizard de ajuste usa ids e bases IBS/CBS)
        items: { include: { taxes: true }, orderBy: { id: 'asc' } },
        // #758: vínculo bidirecional devolução/débito/crédito ↔ original
        referencedDocument: {
          select: { id: true, number: true, series: true, type: true, finalidade: true, status: true, chave: true },
        },
        referencingDocuments: {
          select: { id: true, number: true, series: true, type: true, finalidade: true, status: true, tipoNotaDebito: true, tipoNotaCredito: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!doc) throw new NotFoundException(`Documento fiscal ${id} não encontrado`);
    return doc;
  }

  /**
   * #758 — Preview da nota de ajuste: mesmos guards e motor da emissão (#755),
   * SEM persistir nem transmitir. O wizard mostra a diferença antes do confirm.
   */
  async previewAdjustment(
    originalDocumentId: string,
    companyId: string,
    spec: AdjustmentSpec,
  ) {
    const original = await this.prisma.fiscalDocument.findFirst({
      where: { id: originalDocumentId, companyId },
      include: { items: { include: { taxes: true }, orderBy: { id: 'asc' } } },
    });
    if (!original) throw new NotFoundException(`Documento fiscal ${originalDocumentId} não encontrado`);
    if (original.type !== FiscalDocumentType.NFE || original.status !== FiscalStatus.AUTHORIZED) {
      throw new BadRequestException('Ajuste só é possível sobre NF-e AUTHORIZED.');
    }
    if (original.finalidade !== FiscalFinalidade.NORMAL) {
      throw new BadRequestException('Ajuste referencia apenas a NF-e de venda (finalidade NORMAL).');
    }
    if (!original.items?.length || original.items.some((it: any) => !it.taxes?.length)) {
      throw new BadRequestException('NF-e original sem itens/impostos persistidos — ajuste manual (docs pré-#166).');
    }

    const num = (v: any): number => (v == null ? 0 : Number(v));
    return this.ibsCbsAdjustment.compute(
      original.items.map((it: any) => {
        const t = it.taxes[0];
        return {
          id: it.id,
          sku: it.productCode ?? 'ITEM',
          name: it.productName,
          ncm: it.ncm,
          tax: {
            cClassTrib: t.cClassTrib,
            cstCbs: t.cstCbs,
            baseCbs: num(t.baseCbs),
            valorCbs: num(t.valorCbs),
            baseIbsUf: num(t.baseIbsUf),
            valorIbsUf: num(t.valorIbsUf),
            baseIbsMun: num(t.baseIbsMun),
            valorIbsMun: num(t.valorIbsMun),
          },
        };
      }),
      spec,
    );
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
      select: { id: true, chave: true, xml: true, xmlUrl: true, status: true, focusRef: true, number: true, type: true, companyId: true },
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
    companyId?: string;
  }): Promise<string | null> {
    let xmlUrl = d.xmlUrl;
    let danfeUrl: string | undefined;

    if (!xmlUrl && d.focusRef) {
      const st = await this.client.getStatus(d.type === FiscalDocumentType.NFCE ? 'nfce' : 'nfe', d.focusRef, d.companyId);
      if (st.caminho_xml_nota_fiscal) xmlUrl = this.client.absoluteUrl(st.caminho_xml_nota_fiscal);
      if (st.caminho_danfe) danfeUrl = this.client.absoluteUrl(st.caminho_danfe);
    }
    if (!xmlUrl) return null;

    const xml = await this.client.downloadFile(xmlUrl, d.companyId);
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
          // mesmo xProd transmitido — item veicular persiste "NOME - CHASSI ..."
          productName: buildItemDescription(fi),
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
      // recusa da SEFAZ na autorização (ex.: 726 endereço, 974 respTec) — a Focus
      // devolve status "erro_autorizacao" com o par status_sefaz/mensagem_sefaz
      // (descoberto no onboarding da CRD, 13/07)
      status_sefaz?: string;
      mensagem_sefaz?: string;
    },
  ): Promise<void> {
    const statusMap: Record<string, FiscalStatus> = {
      autorizado: FiscalStatus.AUTHORIZED,
      processando_autorizacao: FiscalStatus.PROCESSING,
      rejeitado: FiscalStatus.REJECTED,
      // recusa da SEFAZ = rejeição (tem código/motivo e aceita retry) — antes
      // caía no fallback ERROR com lastError null (painel ficava mudo)
      erro_autorizacao: FiscalStatus.REJECTED,
      cancelado: FiscalStatus.CANCELLED,
      erro: FiscalStatus.ERROR,
    };

    const newStatus = statusMap[response.status] ?? FiscalStatus.ERROR;
    const codigo = response.codigo ?? response.status_sefaz ?? null;
    // #757: rejeições da Reforma (IBS/CBS) ganham orientação acionável no motivo
    const rawMotivo = response.motivo ?? response.mensagem_sefaz ?? null;
    const guidance = codigo ? REFORMA_REJECTION_GUIDANCE[String(codigo)] : undefined;
    const motivo = rawMotivo && guidance ? `${rawMotivo} — ${guidance}` : rawMotivo;

    // Número/série/protocolo SEFAZ (#361) — Focus retorna numero/serie no response;
    // nProt pode vir no campo protocolo ou embutido no XML autorizado
    const number = response.numero != null ? Number(response.numero) : null;
    const series = response.serie != null ? Number(response.serie) : null;
    const protocolNumber =
      response.protocolo ?? response.xml?.match(/<nProt>(\d+)<\/nProt>/)?.[1] ?? null;

    const updated = await this.prisma.fiscalDocument.update({
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
        rejectionCode: codigo,
        rejectionReason: newStatus === FiscalStatus.REJECTED ? motivo : null,
        lastError: newStatus === FiscalStatus.ERROR ? motivo : null,
      },
    });

    this.logger.log(`FiscalDocument ${fiscalDocId} → ${newStatus}`);

    // #529: autorização dispara a cadeia veicular (BIN → RENAVE → ATPV-e).
    // handleWebhook é idempotente (early-return se já AUTHORIZED) e o ledger
    // RenaveOperation deduplica — emitir aqui cobre webhook E caminho síncrono.
    if (newStatus === FiscalStatus.AUTHORIZED) {
      this.eventEmitter.emit(
        FISCAL_AUTHORIZED_EVENT,
        new FiscalAuthorizedEvent(
          updated.companyId,
          updated.id,
          updated.salesOrderId,
          updated.storeTransferId,
          updated.chave,
        ),
      );
    }
  }
}

/**
 * #757 — orientação acionável p/ rejeições da Reforma Tributária (IBS/CBS,
 * NT 2025.002-RTC). Anexada ao motivo da rejeição no applyFocusResponse.
 */
const REFORMA_REJECTION_GUIDANCE: Record<string, string> = {
  '960': 'Reforma: item sem grupo IBS/CBS obrigatório — confira o cClassTrib do produto e as regras fiscais (Compliance Center).',
  '1106': 'Reforma: cClassTrib inexistente ou incompatível com o CST — revise a classificação tributária do item.',
  '1033': 'Reforma: CST IBS/CBS 2xx exige grupo gRed (percentual de redução + alíquota efetiva).',
  '1026': 'Reforma: alíquotas IBS/CBS fora da tabela vigente (LC 214/2025 art. 343) — confira as TaxRules.',
};

/** Descrição RENAVAM: por ora 1 marca/modelo (600657) — mover p/ campo do Product quando houver mais */
const MARCA_MODELO_DESC: Record<string, string> = {
  '600657': 'R CARRESUL PRT B',
};

/** "0.570" → "0,57" (toneladas com vírgula, 2 casas — padrão das notas antigas) */
function ton(v: string | number | null | undefined): string {
  return Number(v ?? 0).toFixed(2).replace('.', ',');
}

/**
 * Descrição do veículo nas Informações Complementares (pedido Claudio 13/07):
 * "REBOQUE NOVO, COR PRATA, CARROCERIA ABERTA, MARCA R CARRESUL PRT B, COD
 * 600657, COM 1 EIXO, CAP DE CARGA 0,57 TON, PBT 0,75 TON, ANO DE FABRICACAO
 * E MODELO 2026, SEM RESERVA DE DOMINIO. CHASSI ..." (+ pneus novos p/ RS)
 */
export function vehicleInfCpl(v: FiscalVehicleData, ufDestino?: string): string {
  const parts: string[] = [];
  parts.push(`REBOQUE ${v.condicao === '1' ? 'NOVO' : 'USADO'}`);
  if (v.descricaoCor && v.descricaoCor !== 'NAO INFORMADA') parts.push(`COR ${v.descricaoCor.toUpperCase()}`);
  parts.push('CARROCERIA ABERTA');
  const marca = MARCA_MODELO_DESC[v.codigoMarcaModelo];
  parts.push(marca ? `MARCA ${marca}, COD ${v.codigoMarcaModelo}` : `COD ${v.codigoMarcaModelo}`);
  if (v.qtdEixos) parts.push(`COM ${v.qtdEixos} EIXO${v.qtdEixos > 1 ? 'S' : ''}`);
  parts.push(`CAP DE CARGA ${ton(v.pesoLiquido)} TON`);
  parts.push(`PBT ${ton(v.pesoBruto)} TON`);
  parts.push(
    v.anoFabricacao === v.anoModelo
      ? `ANO DE FABRICACAO E MODELO ${v.anoModelo}`
      : `ANO FABRICACAO ${v.anoFabricacao} MODELO ${v.anoModelo}`,
  );
  parts.push(v.restricao === '0' ? 'SEM RESERVA DE DOMINIO' : 'COM RESTRICAO');
  let text = `${parts.join(', ')}. CHASSI ${v.chassi}`;
  if (ufDestino === 'RS') text += '. REBOQUE COM PNEUS NOVOS';
  return text;
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
  // Fase 2 contas a pagar — valores usados no financeiro, não em emissão de
  // NF-e de venda; mapeados por completude do Record (tabela 4.3.4.1).
  DEBITO_AUTOMATICO: '19', // débito automático (NT 2023.004)
  OUTROS: '99',
};
