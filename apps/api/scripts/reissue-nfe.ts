/**
 * Cancelar e reemitir uma NF-e de venda (#1152) FORA da API — operação
 * assistida, com o MESMO FiscalService.reissue de produção, instanciado à
 * mão (sem crons, sem listeners). Uso pontual quando não há sessão web.
 *
 *   FOCUS_NFE_BASE_URL/FOCUS_NFE_TOKEN__<companyId> no ambiente (Railway),
 *   DATABASE_URL do banco alvo.
 *
 *   npx tsx scripts/reissue-nfe.ts <fiscalDocumentId> "<justificativa>" --dry
 *   CONFIRM_REISSUE=true npx tsx scripts/reissue-nfe.ts <fiscalDocumentId> "<justificativa>"
 */
import 'reflect-metadata';
import axios from 'axios';
import { writeFileSync } from 'fs';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../src/prisma/prisma.service';
import { FiscalClientService } from '../src/modules/fiscal/fiscal-client.service';
import { FiscalService } from '../src/modules/fiscal/fiscal.service';
import { TaxCalculationService } from '../src/modules/tax/tax-calculation.service';
import { IbsCbsAdjustmentService } from '../src/modules/fiscal/ibscbs-adjustment.service';

const [docId, justificativa, flag] = process.argv.slice(2);
const dry = flag === '--dry';
if (!docId || !justificativa || justificativa.trim().length < 15) {
  console.error('uso: reissue-nfe.ts <fiscalDocumentId> "<justificativa ≥ 15>" [--dry]');
  process.exit(1);
}
const base = process.env.FOCUS_NFE_BASE_URL ?? '';
if (!base.includes('api.focusnfe.com.br')) {
  console.error(`FOCUS_NFE_BASE_URL não é produção: ${base || '(vazio)'}`);
  process.exit(1);
}
if (!dry && process.env.CONFIRM_REISSUE !== 'true') {
  console.error('Sem CONFIRM_REISSUE=true — rode com --dry ou confirme.');
  process.exit(1);
}

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const client = new FiscalClientService(new HttpService(axios.create()), new ConfigService());
  const service = new FiscalService(prisma, client, new TaxCalculationService(prisma), new EventEmitter2(), new IbsCbsAdjustmentService());

  const show = async (label: string) => {
    const doc = await prisma.fiscalDocument.findUnique({
      where: { id: docId },
      select: { id: true, companyId: true, status: true, type: true, finalidade: true, number: true, series: true, chave: true, focusRef: true, createdAt: true, authorizedAt: true, salesOrderId: true, danfeUrl: true, lastError: true },
    });
    if (!doc) throw new Error(`doc ${docId} não encontrado`);
    const titulos = await prisma.financialEntry.findMany({
      where: { salesOrderId: doc.salesOrderId!, type: 'RECEIVABLE' },
      orderBy: { dueDate: 'asc' },
      select: { status: true, amount: true, dueDate: true, installmentNumber: true },
    });
    const arquivos = doc.salesOrderId
      ? await prisma.fiscalDocument.findMany({
          where: { companyId: doc.companyId, salesOrderId: null, status: 'CANCELLED', focusRef: { startsWith: `GDR-SO-${doc.salesOrderId}` } },
          select: { id: true, number: true, chave: true, focusRef: true, cancelledAt: true },
        })
      : [];
    console.log(`\n── ${label}`);
    console.log('doc:', JSON.stringify({ ...doc, createdAt: doc.createdAt.toISOString(), authorizedAt: doc.authorizedAt?.toISOString() ?? null }));
    console.log('títulos:', titulos.map((t) => `${t.installmentNumber}/${titulos.length} ${t.dueDate.toISOString().slice(0, 10)} R$${Number(t.amount).toFixed(2)} ${t.status}`).join(' | '));
    console.log('arquivos (NF-e canceladas desta venda):', JSON.stringify(arquivos));
    return doc;
  };

  const before = await show('ANTES');
  const token = process.env[`FOCUS_NFE_TOKEN__${before.companyId}`];
  console.log(`token escopado p/ ${before.companyId}: ${token ? 'presente' : 'AUSENTE (cairia no global)'}`);
  const horas = (Date.now() - before.createdAt.getTime()) / 3_600_000;
  console.log(`horas desde a emissão: ${horas.toFixed(2)} (limite 24)`);

  if (dry) {
    console.log('\n--dry: nada executado.');
    await prisma.onModuleDestroy();
    return;
  }

  console.log('\n▶ reissue…');
  await service.reissue(docId, before.companyId, justificativa);

  // A autorização final chega pelo webhook da Focus na API de prod. Aqui só
  // acompanhamos pelo banco; se demorar, consultamos a Focus e aplicamos.
  for (let i = 0; i < 24; i++) {
    const d = await prisma.fiscalDocument.findUnique({ where: { id: docId }, select: { status: true, focusRef: true } });
    if (d?.status === 'AUTHORIZED' || d?.status === 'REJECTED' || d?.status === 'ERROR') break;
    if (i === 6 && d?.focusRef) {
      const st = await client.getStatus('nfe', d.focusRef, before.companyId).catch(() => null);
      if (st && st.status !== 'processando_autorizacao') await (service as any).applyFocusResponse(docId, st);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  const after = await show('DEPOIS');
  if (after.status === 'AUTHORIZED' && after.chave) {
    const xmlDoc = await prisma.fiscalDocument.findUnique({ where: { id: docId }, select: { xml: true } });
    const xml = xmlDoc?.xml ?? '';
    const tags = (t: string) => [...xml.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, 'g'))].map((m) => m[1]);
    console.log('XML cobr:', JSON.stringify({ nFat: tags('nFat'), vLiq: tags('vLiq'), nDup: tags('nDup'), dVenc: tags('dVenc'), vDup: tags('vDup'), indPag: tags('indPag') }));
    if (after.danfeUrl && process.env.DANFE_DIR) {
      const pdf = await axios.get(after.danfeUrl, { responseType: 'arraybuffer', auth: { username: token ?? process.env.FOCUS_NFE_TOKEN ?? '', password: '' } });
      const file = `${process.env.DANFE_DIR}/danfe-reemitida-${after.number}.pdf`;
      writeFileSync(file, Buffer.from(pdf.data));
      console.log('DANFE salva em', file);
    }
  }
  await prisma.onModuleDestroy();
}

main().catch(async (e) => { console.error('ERRO:', e?.message ?? e); process.exit(1); });
