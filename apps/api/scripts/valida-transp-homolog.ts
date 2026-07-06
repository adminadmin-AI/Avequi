/**
 * Validação em homologação — grupo transp + orig + GTIN (#481/#480/#484, PR #488)
 *
 * Emite NF-e de teste na homologação Focus/SEFAZ e valida no XML autorizado:
 *  - modFrete, transporta (CNPJ/xNome/IE/ender/mun/UF), veicTransp (placa/UF),
 *    vol (qVol/esp/pesoL/pesoB) e vFrete — nomes flat da Focus (#481)
 *  - orig do produto no grupo ICMS (#480)
 *  - cEAN/cEANTrib quando o produto tem GTIN (#484)
 *  - vPag = vNF com frete somado (fix do detPag)
 *
 * Uso: npx tsx apps/api/scripts/valida-transp-homolog.ts
 */

import { buildNFePayload, FiscalItem, FiscalPayloadInput } from '../src/modules/fiscal/fiscal-mapper';

const FOCUS_TOKEN = process.env.FOCUS_NFE_TOKEN ?? '';
const BASE = process.env.FOCUS_NFE_BASE_URL ?? 'https://homologacao.focusnfe.com.br';
if (!FOCUS_TOKEN) {
  console.error('FOCUS_NFE_TOKEN não definido');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${FOCUS_TOKEN}:`).toString('base64');
const RUN = Date.now();

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
  name: 'CLIENTE TESTE TRANSP',
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

function item(opts: { origem?: string; ean?: string } = {}): FiscalItem {
  const total = 1000;
  return {
    sku: `TRP-${RUN % 100000}`,
    name: 'ENGATE TESTE VALIDACAO TRANSP',
    ncm: '87169090',
    quantity: 1,
    unitPrice: total,
    unit: 'UN',
    origem: opts.origem,
    ean: opts.ean,
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

async function fetchXml(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: AUTH } });
  return res.text();
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
const has = (xml: string, t: string) => xml.includes(`<${t}>`) || xml.includes(`<${t} `);
const check = (name: string, ok: boolean, detail = '') =>
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);

async function emit(id: string, name: string, input: FiscalPayloadInput): Promise<{ status: string; xml?: string; data: any }> {
  const ref = `GDR-TRP-${RUN}-${id}`;
  console.log(`\n▶ [${id}] ${name} (ref ${ref})`);
  const payload = buildNFePayload(input);
  const { data: emitData } = await api('POST', `/v2/nfe?ref=${ref}`, payload);
  const data = emitData?.status === 'processando_autorizacao' ? await pollFinal(ref) : emitData;
  console.log(`  status: ${data?.status} ${data?.status_sefaz ?? ''} ${data?.mensagem_sefaz ?? data?.mensagem ?? ''}`.trim());
  if (data?.status === 'autorizado' && data.caminho_xml_nota_fiscal) {
    return { status: data.status, xml: await fetchXml(data.caminho_xml_nota_fiscal), data };
  }
  return { status: data?.status ?? 'erro', data };
}

async function main() {
  // ── A: frete por terceiros — transportador completo + placa + volumes + vFrete + orig 2 ──
  const a = await emit('A', 'frete terceiros: transporta + veicTransp + vol + vFrete + orig 2', {
    ref: '',
    emitter,
    recipient,
    items: [item({ origem: '2' })],
    totalValue: 1000,
    consumidorFinal: true,
    freight: {
      modality: '2',
      value: 150,
      carrier: {
        document: '11.444.777/0001-61',
        name: 'TRANSPORTES VALIDACAO LTDA',
        ie: 'ISENTO', // IE não-numérica é filtrada pelo mapper
        address: 'ROD BR 116 KM 1',
        city: 'CURITIBA',
        state: 'PR',
      },
      vehiclePlate: 'ABC1D23',
      vehiclePlateState: 'PR',
      volumes: [{ quantidade: 2, especie: 'VOLUMES', marca: 'GDR', pesoLiquido: 120.5, pesoBruto: 130 }],
    },
  });
  if (a.xml) {
    check('modFrete = 2', tag(a.xml, 'modFrete') === '2', `modFrete=${tag(a.xml, 'modFrete')}`);
    check('grupo transporta (CNPJ)', tag(a.xml, 'CNPJ') !== undefined && a.xml.includes('<transporta>'), `xNome=${a.xml.match(/<transporta>[\s\S]*?<xNome>([^<]*)</)?.[1]}`);
    check('veicTransp com placa', has(a.xml, 'veicTransp') && tag(a.xml, 'placa') === 'ABC1D23', `placa=${tag(a.xml, 'placa') ?? 'AUSENTE ⚠️ (nome do campo veiculo_placa não aceito?)'}`);
    check('vol: qVol/esp/pesos', tag(a.xml, 'qVol') === '2' && tag(a.xml, 'esp') === 'VOLUMES' && tag(a.xml, 'pesoL') === '120.500', `qVol=${tag(a.xml, 'qVol')} esp=${tag(a.xml, 'esp')} pesoL=${tag(a.xml, 'pesoL')} pesoB=${tag(a.xml, 'pesoB')}`);
    check('vFrete no ICMSTot', tag(a.xml, 'vFrete') === '150.00', `vFrete=${tag(a.xml, 'vFrete')}`);
    check('orig = 2 no ICMS', tag(a.xml, 'orig') === '2', `orig=${tag(a.xml, 'orig')}`);
    check('vPag = vNF (frete somado)', tag(a.xml, 'vPag') === tag(a.xml, 'vNF'), `vPag=${tag(a.xml, 'vPag')} vNF=${tag(a.xml, 'vNF')}`);
  }

  // ── B: GTIN no cEAN/cEANTrib + modalidade 3 (veículo próprio, sem transportadora) ──
  const b = await emit('B', 'GTIN + veículo próprio (modalidade 3, só volumes)', {
    ref: '',
    emitter,
    recipient,
    items: [item({ origem: '0', ean: '7891234567895' })],
    totalValue: 1000,
    consumidorFinal: true,
    freight: {
      modality: '3',
      volumes: [{ quantidade: 1, especie: 'REBOQUE' }],
    },
  });
  if (b.xml) {
    check('modFrete = 3', tag(b.xml, 'modFrete') === '3', `modFrete=${tag(b.xml, 'modFrete')}`);
    check('sem grupo transporta', !b.xml.includes('<transporta>'));
    check('cEAN com GTIN', tag(b.xml, 'cEAN') === '7891234567895', `cEAN=${tag(b.xml, 'cEAN')}`);
    check('cEANTrib com GTIN', tag(b.xml, 'cEANTrib') === '7891234567895', `cEANTrib=${tag(b.xml, 'cEANTrib')}`);
    check('vol qVol=1 esp=REBOQUE', tag(b.xml, 'qVol') === '1' && tag(b.xml, 'esp') === 'REBOQUE', `qVol=${tag(b.xml, 'qVol')} esp=${tag(b.xml, 'esp')}`);
    check('orig = 0', tag(b.xml, 'orig') === '0', `orig=${tag(b.xml, 'orig')}`);
  } else if (b.status === 'rejeitado') {
    console.log('  ℹ️ Se a rejeição for de GTIN (CCG), o cadastro real precisa de GTIN registrado — SEM GTIN continua ok.');
  }

  console.log('\nConcluído.');
}

main().catch((e) => { console.error(e); process.exit(1); });
