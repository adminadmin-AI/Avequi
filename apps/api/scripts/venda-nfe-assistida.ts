/**
 * Venda + NF-e assistida FORA da API (#1152) — mesmos serviços de produção
 * instanciados à mão (sem crons/listeners), na ordem que garante que os
 * títulos já existam (com o prazo pedido) quando a NF-e é montada.
 *
 * Fluxo: produto (cria se faltar) → entrada de estoque (se faltar saldo) →
 * pedido → reserva → confirmação → separação (sem WMS) → conferência →
 * faturamento → títulos (financeiro) → vencimentos no prazo pedido →
 * NF-e (duplicatas = títulos).
 *
 *   npx tsx scripts/venda-nfe-assistida.ts '<json>' --dry
 *   CONFIRM_SALE=true npx tsx scripts/venda-nfe-assistida.ts '<json>'
 */
import 'reflect-metadata';
import axios from 'axios';
import { writeFileSync } from 'fs';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../src/prisma/prisma.service';
import { SalesService } from '../src/modules/sales/sales.service';
import { StockService } from '../src/modules/stock/stock.service';
import { TaxCalculationService } from '../src/modules/tax/tax-calculation.service';
import { AcquirerService } from '../src/modules/acquirer/acquirer.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { FiscalClientService } from '../src/modules/fiscal/fiscal-client.service';
import { FiscalService } from '../src/modules/fiscal/fiscal.service';
import { IbsCbsAdjustmentService } from '../src/modules/fiscal/ibscbs-adjustment.service';
import { SYSTEM_CONTEXT } from '../src/modules/iam/scope';
import { dataOperacionalHoje, limiteDeDataPura, somarDias } from '../src/common/date/dia-operacional';

const [jsonArg, flag] = process.argv.slice(2);
const dry = flag === '--dry';
if (!jsonArg) { console.error('uso: venda-nfe-assistida.ts <json> [--dry]'); process.exit(1); }
const P = JSON.parse(jsonArg) as {
  companyId: string; customerId: string; warehouseId: string;
  product: { sku: string; name: string; ncm: string; cest?: string; origem: string; unit: string; salePrice: number };
  quantity: number; unitPrice: number; installments: number; dueDays: number[];
  notes: string; stockReason: string; justificativaNaoUsada?: string;
};
const base = process.env.FOCUS_NFE_BASE_URL ?? '';
if (!base.includes('api.focusnfe.com.br')) { console.error(`FOCUS_NFE_BASE_URL não é produção: ${base || '(vazio)'}`); process.exit(1); }
if (!dry && process.env.CONFIRM_SALE !== 'true') { console.error('Sem CONFIRM_SALE=true — rode com --dry ou confirme.'); process.exit(1); }
if (P.dueDays.length !== P.installments) { console.error('dueDays deve ter 1 prazo por parcela'); process.exit(1); }

const r2 = (v: number) => Math.round(v * 100) / 100;
const total = r2(P.quantity * P.unitPrice);
const naoUsado = (nome: string) => new Proxy({}, { get: (_t, prop) => () => { throw new Error(`${nome}.${String(prop)} não deveria ser chamado neste fluxo`); } });

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const stock = new StockService(prisma);
  const taxCalc = new TaxCalculationService(prisma);
  const sales = new SalesService(
    prisma, new EventEmitter2(), stock, taxCalc,
    { assertWithinLimit: async () => undefined } as any, // sem desconto: preço = tabela
    new AcquirerService(prisma),
    naoUsado('PaymentAuthorizationService') as any, // só cartão
    naoUsado('PermissionService') as any, // SYSTEM_CONTEXT não consulta escopo
  );
  const finance = new FinanceService(prisma, naoUsado('SupplierAdvanceService') as any);
  const client = new FiscalClientService(new HttpService(axios.create()), new ConfigService());
  const fiscal = new FiscalService(prisma, client, taxCalc, new EventEmitter2(), new IbsCbsAdjustmentService());

  console.log(`\n── PLANO: ${P.quantity} × ${P.product.name} a R$ ${P.unitPrice.toFixed(2)} = R$ ${total.toFixed(2)} · ${P.installments}× boleto em ${P.dueDays.join('/')} dias`);
  const hoje = dataOperacionalHoje();
  console.log('vencimentos:', P.dueDays.map((d) => somarDias(hoje, d)).join(', '));

  const customer = await prisma.customer.findFirst({ where: { id: P.customerId, companyId: P.companyId }, select: { name: true, document: true, type: true, state: true } });
  const warehouse = await prisma.warehouse.findFirst({ where: { id: P.warehouseId, companyId: P.companyId }, select: { name: true } });
  if (!customer || !warehouse) throw new Error('cliente ou depósito não encontrado na empresa');
  console.log('cliente:', JSON.stringify(customer), '· depósito:', warehouse.name);

  let product = await prisma.product.findFirst({ where: { companyId: P.companyId, OR: [{ sku: P.product.sku }, { name: P.product.name }] } });
  console.log('produto:', product ? `EXISTE ${product.id} (${product.sku} · ncm ${product.ncm})` : `AUSENTE → criar ${JSON.stringify(P.product)}`);
  const balance = product ? await prisma.stockBalance.findUnique({ where: { warehouseId_productId: { warehouseId: P.warehouseId, productId: product.id } } }) : null;
  const disponivel = Number(balance?.available ?? 0);
  console.log(`saldo disponível: ${disponivel} (precisa ${P.quantity}) → ${disponivel >= P.quantity ? 'ok' : `ENTRADA de ${P.quantity - disponivel}`}`);
  const rules = await prisma.taxRule.count({ where: { companyId: P.companyId, operationType: 'VENDA_INTERNA', isActive: true } });
  console.log('regras fiscais VENDA_INTERNA ativas:', rules);

  if (dry) { console.log('\n--dry: nada executado.'); await prisma.onModuleDestroy(); return; }

  // 1. produto
  if (!product) {
    product = await prisma.product.create({
      data: { companyId: P.companyId, sku: P.product.sku, name: P.product.name, type: 'FINISHED_GOOD', unit: P.product.unit, ncm: P.product.ncm, cest: P.product.cest ?? null, origem: P.product.origem, salePrice: P.product.salePrice, isActive: true },
    });
    console.log('✔ produto criado', product.id);
  }
  // 2. estoque
  if (disponivel < P.quantity) {
    await stock.move({ companyId: P.companyId, warehouseId: P.warehouseId, productId: product.id, type: 'ENTRY' as any, quantity: P.quantity - disponivel, reason: P.stockReason });
    console.log('✔ entrada de estoque', P.quantity - disponivel);
  }
  // 3. pedido → 4. reserva → 5. confirmação → 6. separação → 7. conferência → 8. faturamento
  const order = await sales.createOrder({
    warehouseId: P.warehouseId, customerId: P.customerId, channel: 'FACTORY', paymentMethod: 'BOLETO' as any, freightModality: '9', notes: P.notes,
    items: [{ productId: product.id, quantity: P.quantity, unitPrice: P.unitPrice }],
    payments: [{ method: 'BOLETO' as any, amount: total, installments: P.installments }],
  } as any, P.companyId, SYSTEM_CONTEXT);
  console.log('✔ pedido', order.id, order.status);
  await sales.reserveOrder(order.id, P.companyId, SYSTEM_CONTEXT); console.log('✔ reservado');
  await sales.confirmOrder(order.id, P.companyId, SYSTEM_CONTEXT); console.log('✔ confirmado');
  await sales.marcarSeparacaoConcluida(order.id, SYSTEM_CONTEXT); console.log('✔ separação concluída');
  await sales.conferOrder(order.id, P.companyId, { items: order.items.map((i: any) => ({ saleItemId: i.id, quantity: Number(i.quantity) })) }, SYSTEM_CONTEXT); console.log('✔ conferido');
  await sales.invoiceOrder(order.id, P.companyId, SYSTEM_CONTEXT); console.log('✔ faturado (estoque baixado)');

  // 9. títulos + 10. prazo pedido
  await finance.createReceivableForSale({ companyId: P.companyId, salesOrderId: order.id, amount: total });
  const titulos = await prisma.financialEntry.findMany({ where: { companyId: P.companyId, salesOrderId: order.id, type: 'RECEIVABLE' }, orderBy: { installmentNumber: 'asc' }, take: 120 });
  for (const t of titulos) {
    const dias = P.dueDays[(t.installmentNumber ?? 1) - 1];
    await prisma.financialEntry.update({ where: { id: t.id }, data: { dueDate: limiteDeDataPura(somarDias(hoje, dias)) } });
  }
  const tit2 = await prisma.financialEntry.findMany({ where: { companyId: P.companyId, salesOrderId: order.id, type: 'RECEIVABLE' }, orderBy: { dueDate: 'asc' }, take: 120 });
  console.log('✔ títulos:', tit2.map((t) => `${t.installmentNumber}/${tit2.length} ${t.dueDate.toISOString().slice(0, 10)} R$${Number(t.amount).toFixed(2)}`).join(' | '));

  // 11. NF-e
  await fiscal.emitForSale(order.id, 'NFE' as any);
  let doc: any = null;
  for (let i = 0; i < 24; i++) {
    doc = await prisma.fiscalDocument.findUnique({ where: { salesOrderId: order.id } });
    if (doc && ['AUTHORIZED', 'REJECTED', 'ERROR'].includes(doc.status)) break;
    if (i === 6 && doc?.focusRef) {
      const st = await client.getStatus('nfe', doc.focusRef, P.companyId).catch(() => null);
      if (st && st.status !== 'processando_autorizacao') await (fiscal as any).applyFocusResponse(doc.id, st);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('NF-e:', JSON.stringify({ id: doc?.id, status: doc?.status, number: doc?.number, chave: doc?.chave, focusRef: doc?.focusRef, rejection: doc?.rejectionReason ?? doc?.lastError }));
  if (doc?.status === 'AUTHORIZED' && doc.xmlUrl) {
    const token = process.env[`FOCUS_NFE_TOKEN__${P.companyId}`] ?? process.env.FOCUS_NFE_TOKEN ?? '';
    const xml = (await axios.get(doc.xmlUrl, { auth: { username: token, password: '' } })).data as string;
    const tags = (t: string) => [...xml.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, 'g'))].map((m) => m[1]);
    console.log('XML:', JSON.stringify({ xProd: tags('xProd'), NCM: tags('NCM'), CEST: tags('CEST'), CFOP: tags('CFOP'), CSOSN: tags('CSOSN'), vNF: tags('vNF'), nFat: tags('nFat'), vLiq: tags('vLiq'), dup: tags('nDup').map((n, i) => `${n} ${tags('dVenc')[i]} ${tags('vDup')[i]}`), indPag: tags('indPag') }));
    if (doc.danfeUrl && process.env.DANFE_DIR) {
      const pdf = await axios.get(doc.danfeUrl, { responseType: 'arraybuffer', auth: { username: token, password: '' } });
      const file = `${process.env.DANFE_DIR}/danfe-${doc.number}.pdf`; writeFileSync(file, Buffer.from(pdf.data)); console.log('DANFE salva em', file);
    }
  }
  await prisma.onModuleDestroy();
}
main().catch(async (e) => { console.error('ERRO:', e?.message ?? e); process.exit(1); });
