/**
 * Validação em homologação — grupo cobr: fatura + duplicatas (#1152)
 *
 * Emite NF-e de teste na homologação Focus/SEFAZ e valida no XML autorizado:
 *  - <cobr><fat> nFat/vOrig/vDesc/vLiq e <dup> nDup/dVenc/vDup — nomes flat
 *    da Focus (numero_fatura, valor_*_fatura, duplicatas[])
 *  - indPag=1 na forma a prazo; forma à vista sem indPag=1
 *  - soma das duplicatas = vLiq
 * Baixa a DANFE em PDF no diretório informado por DANFE_DIR (opcional).
 *
 * Uso: npx tsx apps/api/scripts/valida-cobr-homolog.ts
 */

import { writeFileSync } from 'fs';
import { buildNFePayload, FiscalItem, FiscalPayloadInput } from '../src/modules/fiscal/fiscal-mapper';
import { comoDataOperacional, dataOperacionalHoje, somarDias } from '../src/common/date/dia-operacional';

const FOCUS_TOKEN = process.env.FOCUS_NFE_TOKEN ?? '';
const BASE = process.env.FOCUS_NFE_BASE_URL ?? 'https://homologacao.focusnfe.com.br';
if (!FOCUS_TOKEN) {
  console.error('FOCUS_NFE_TOKEN não definido');
  process.exit(1);
}
if (!BASE.includes('homologacao')) {
  console.error(`Recusando rodar fora da homologação: ${BASE}`);
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${FOCUS_TOKEN}:`).toString('base64');
const RUN = Date.now();
const DANFE_DIR = process.env.DANFE_DIR;

const emitter = {
  cnpj: '46.247.069/0001-15',
  name: 'GDR INDUSTRIA E COMERCIO DE REBOQUES LTDA',
  ie: '9095313067',
  crt: 3,
  address: 'RUA ANTONIO SINGER',
  number: '4075',
  complement: 'BARRACAO 02',
  neighborhood: 'CAMPO LARGO DA ROSEIRA',
  city: 'SAO JOSE DOS PINHAIS',
  state: 'PR',
  zipCode: '83091002',
  ibgeCode: '4125506',
  phone: '4133828000',
};

const recipient = {
  name: 'CLIENTE TESTE COBR',
  document: '030.550.549-11',
  indIeDest: 'NAO_CONTRIBUINTE' as const,
  address: 'RUA XV DE NOVEMBRO',
  number: '100',
  neighborhood: 'CENTRO',
  city: 'CURITIBA',
  state: 'PR',
  zipCode: '80020310',
  ibgeCode: '4106902',
};

const r2 = (v: number) => Math.round(v * 100) / 100;

function item(total: number): FiscalItem {
  return {
    sku: `COB-${RUN % 100000}`,
    name: 'ENGATE TESTE VALIDACAO COBR',
    ncm: '87169090',
    quantity: 1,
    unitPrice: total,
    unit: 'UN',
    origem: '0',
    tax: {
      cfop: '5101',
      icmsCst: '00',
      icmsBase: total, icmsAliquota: 12, icmsValor: r2(total * 0.12),
      ipiCst: '51', ipiBase: total, ipiAliquota: 0, ipiValor: 0,
      pisCst: '49', pisBase: total, pisAliquota: 0, pisValor: 0,
      cofinsCst: '99', cofinsBase: 0, cofinsAliquota: 0, cofinsValor: 0,
      ibsCbs: {
        cClassTrib: '000001', cbsCst: '000', base: total,
        cbsAliquota: 0.9, cbsValor: r2(total * 0.009),
        ibsUfAliquota: 0.1, ibsUfValor: r2(total * 0.001),
        ibsMunAliquota: 0, ibsMunValor: 0,
      },
    },
  };
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  return { http: res.status, data };
}

async function fetchRaw(path: string): Promise<Buffer> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: AUTH } });
  return Buffer.from(await res.arrayBuffer());
}

async function pollFinal(ref: string, maxS = 60): Promise<any> {
  for (let i = 0; i < maxS / 3; i++) {
    const { data } = await api('GET', `/v2/nfe/${ref}`);
    if (data?.status && data.status !== 'processando_autorizacao') return data;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { status: 'timeout' };
}

const tag = (xml: string, t: string) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1];
const tags = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, 'g'))].map((m) => m[1]);
const check = (name: string, ok: boolean, detail = '') =>
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);

async function emit(id: string, name: string, input: FiscalPayloadInput) {
  const ref = `GDR-COB-${RUN}-${id}`;
  console.log(`\n▶ [${id}] ${name} (ref ${ref})`);
  const payload = buildNFePayload(input);
  console.log('  cobr enviado:', JSON.stringify({
    numero_fatura: payload.numero_fatura, valor_liquido_fatura: payload.valor_liquido_fatura, duplicatas: payload.duplicatas,
  }));
  const { data: emitData } = await api('POST', `/v2/nfe?ref=${ref}`, payload);
  const data = emitData?.status === 'processando_autorizacao' ? await pollFinal(ref) : emitData;
  console.log(`  status: ${data?.status} ${data?.status_sefaz ?? ''} ${data?.mensagem_sefaz ?? data?.mensagem ?? ''}`.trim());
  if (data?.erros) console.log('  erros:', JSON.stringify(data.erros));
  if (data?.status === 'autorizado' && data.caminho_xml_nota_fiscal) {
    const xml = (await fetchRaw(data.caminho_xml_nota_fiscal)).toString('utf8');
    if (DANFE_DIR && data.caminho_danfe) {
      const pdf = await fetchRaw(data.caminho_danfe);
      const file = `${DANFE_DIR}/danfe-cobr-${id}.pdf`;
      writeFileSync(file, pdf);
      console.log(`  DANFE: ${file} (${pdf.length} bytes) nNF=${tag(xml, 'nNF')}`);
    }
    return { status: data.status, xml, data };
  }
  return { status: data?.status ?? 'erro', data };
}

async function main() {
  const hoje = dataOperacionalHoje();
  const venc = (dias: number) => somarDias(hoje, dias);
  comoDataOperacional(hoje);

  // ── A: boleto 3× de 1.000 → 3 duplicatas 333,33/333,33/333,34 ──
  const a = await emit('A', 'boleto 3×: cobr com 3 duplicatas + indPag=1', {
    ref: '',
    emitter,
    recipient,
    items: [item(1000)],
    totalValue: 1000,
    consumidorFinal: true,
    payments: [{ tPag: '15', amount: 1000, aPrazo: true }],
    billing: {
      numero: 'ABC123',
      duplicatas: [
        { numero: '001', vencimento: venc(30), valor: 333.33 },
        { numero: '002', vencimento: venc(60), valor: 333.33 },
        { numero: '003', vencimento: venc(90), valor: 333.34 },
      ],
    },
  });
  if (a.xml) {
    check('grupo <cobr><fat>', a.xml.includes('<cobr>') && a.xml.includes('<fat>'));
    check('nFat = ABC123', tag(a.xml, 'nFat') === 'ABC123', `nFat=${tag(a.xml, 'nFat')}`);
    check('vOrig/vLiq (vDesc omitido)', tag(a.xml, 'vOrig') === '1000.00' && tag(a.xml, 'vLiq') === '1000.00',
      `vOrig=${tag(a.xml, 'vOrig')} vDesc=${tag(a.xml, 'vDesc') ?? '—'} vLiq=${tag(a.xml, 'vLiq')}`);
    check('3 <dup> sequenciais', JSON.stringify(tags(a.xml, 'nDup')) === JSON.stringify(['001', '002', '003']), `nDup=${tags(a.xml, 'nDup')}`);
    check('dVenc 30/60/90', JSON.stringify(tags(a.xml, 'dVenc')) === JSON.stringify([venc(30), venc(60), venc(90)]), `dVenc=${tags(a.xml, 'dVenc')}`);
    check('vDup fecha 1000', JSON.stringify(tags(a.xml, 'vDup')) === JSON.stringify(['333.33', '333.33', '333.34']), `vDup=${tags(a.xml, 'vDup')}`);
    check('indPag = 1 no detPag', tag(a.xml, 'indPag') === '1', `indPag=${tag(a.xml, 'indPag')} tPag=${tag(a.xml, 'tPag')}`);
  }

  // ── B: misto PIX 400 + boleto 2× 600 → 2 duplicatas 300/300; fatura 600 ──
  const b = await emit('B', 'misto PIX + boleto 2×: duplicatas só do boleto, fatura = 600', {
    ref: '',
    emitter,
    recipient,
    items: [item(1000)],
    totalValue: 1000,
    consumidorFinal: true,
    payments: [
      { tPag: '17', amount: 400 },
      { tPag: '15', amount: 600, aPrazo: true },
    ],
    billing: {
      numero: 'DEF456',
      duplicatas: [
        { numero: '001', vencimento: venc(30), valor: 300 },
        { numero: '002', vencimento: venc(60), valor: 300 },
      ],
    },
  });
  if (b.xml) {
    check('vLiq = 600 (só a parte a prazo)', tag(b.xml, 'vLiq') === '600.00', `vLiq=${tag(b.xml, 'vLiq')} vNF=${tag(b.xml, 'vNF')}`);
    check('2 <dup>', tags(b.xml, 'nDup').length === 2, `nDup=${tags(b.xml, 'nDup')}`);
    const indPags = tags(b.xml, 'indPag');
    const tPags = tags(b.xml, 'tPag');
    check('indPag: PIX sem 1, boleto com 1', tPags.join(',') === '17,15' && indPags.length === 1 && indPags[0] === '1',
      `tPag=${tPags} indPag=${indPags}`);
  }

  console.log('\nConcluído.');
}

main().catch((e) => { console.error(e); process.exit(1); });
