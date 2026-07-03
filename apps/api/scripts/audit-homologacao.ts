/**
 * Auditoria E2E — Emissão NF-e em homologação Focus/SEFAZ
 *
 * Roda uma matriz de cenários (geografia/DIFAL, tipos de destinatário,
 * composição da nota, ciclo de vida e IBS/CBS), valida o CONTEÚDO dos XMLs
 * autorizados (não só o status) e gera relatório markdown.
 *
 * Uso: npx tsx apps/api/scripts/audit-homologacao.ts
 */

import { writeFileSync } from 'fs';
import {
  buildNFePayload,
  buildTransferNFePayload,
  FiscalPayloadInput,
  FiscalItem,
  FiscalVehicleData,
} from '../src/modules/fiscal/fiscal-mapper';

const FOCUS_TOKEN = process.env.FOCUS_NFE_TOKEN ?? '';
const BASE = process.env.FOCUS_NFE_BASE_URL ?? 'https://homologacao.focusnfe.com.br';
if (!FOCUS_TOKEN) {
  console.error('FOCUS_NFE_TOKEN não definido');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${FOCUS_TOKEN}:`).toString('base64');
const RUN = Date.now();

// ─── Dados base ──────────────────────────────────────────────────────────────
const emitter = {
  cnpj: '46.247.069/0001-15',
  name: 'GDR INDUSTRIA E COMERCIO DE REBOQUES LTDA',
  ie: '9095313067',
  crt: 3,
  address: 'RUA FRANCISCO STRAPASSON',
  number: '303',
  neighborhood: 'BORDA DO CAMPO',
  city: 'SAO JOSE DOS PINHAIS',
  state: 'PR',
  zipCode: '83045-090',
  ibgeCode: '4125506',
  phone: '4130853400',
};

const PF = { name: 'CLIENTE PF TESTE', document: '030.550.549-11' };
const CITIES: Record<string, { city: string; cep: string; interna: number; fcpEsperado: number }> = {
  PR: { city: 'CURITIBA', cep: '80010-000', interna: 12, fcpEsperado: 0 },
  SC: { city: 'FLORIANOPOLIS', cep: '88010-000', interna: 17, fcpEsperado: 0 },
  SP: { city: 'SAO PAULO', cep: '01001-000', interna: 18, fcpEsperado: 2 },
  MG: { city: 'BELO HORIZONTE', cep: '30110-000', interna: 18, fcpEsperado: 2 },
  RS: { city: 'PORTO ALEGRE', cep: '90010-000', interna: 17, fcpEsperado: 0 },
  RJ: { city: 'RIO DE JANEIRO', cep: '20010-000', interna: 20, fcpEsperado: 2 },
};

function recipientPF(uf: string) {
  const c = CITIES[uf];
  return { ...PF, address: 'RUA DOS TESTES', number: '100', neighborhood: 'CENTRO', city: c.city, state: uf, zipCode: c.cep };
}

let chassiSeq = 100;
function vehicle(): FiscalVehicleData {
  chassiSeq++;
  return {
    tipoOperacao: '0',
    chassi: `9BGRD08X0XG0${String(chassiSeq).padStart(5, '0')}`,
    codigoCor: '09',
    descricaoCor: 'PRATA',
    potenciaMotor: 0,
    cilindrada: 0,
    pesoLiquido: '0.570',
    pesoBruto: '0.750',
    serie: `SN${chassiSeq}`,
    tipoCombustivel: '11',
    numeroMotor: '0',
    anoModelo: 2026,
    anoFabricacao: 2026,
    tipoPintura: 'S',
    tipoVeiculo: '10',
    especieVeiculo: '2',
    vin: 'N',
    condicao: '1',
    codigoMarcaModelo: '600657',
    corDenatran: '09',
    lotacao: 0,
    restricao: '0',
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Item reboque com tributação completa para a UF destino */
function reboqueItem(opts: {
  value: number; qty?: number; ufDest: string; consumidorFinal: boolean; contribuinte?: boolean;
  withVehicle?: boolean; ibsCbs?: boolean | { cst: string; cClassTrib: string };
}): FiscalItem {
  const qty = opts.qty ?? 1;
  const total = r2(qty * opts.value);
  const interstate = opts.ufDest !== 'PR';
  const icmsAliq = interstate ? 12 : 12; // reboque: 12% interna PR e 12% interestadual
  const interna = CITIES[opts.ufDest].interna;
  const difal = interstate && opts.consumidorFinal && !opts.contribuinte && interna > icmsAliq
    ? { baseCalculo: total, aliquotaInterna: interna, aliquotaInterestadual: icmsAliq, valor: r2(total * (interna - icmsAliq) / 100) }
    : undefined;
  const ibs = opts.ibsCbs === false ? undefined : {
    cClassTrib: typeof opts.ibsCbs === 'object' ? opts.ibsCbs.cClassTrib : '000001',
    cbsCst: typeof opts.ibsCbs === 'object' ? opts.ibsCbs.cst : '000',
    base: total,
    cbsAliquota: 0.9,
    cbsValor: r2(total * 0.9 / 100),
    ibsUfAliquota: 0.1,
    ibsUfValor: r2(total * 0.1 / 100),
    ibsMunAliquota: 0,
    ibsMunValor: 0,
  };
  return {
    sku: `RBQ-AUD-${chassiSeq + 1}`,
    name: 'REBOQUE BASCULANTE TESTE AUDITORIA',
    ncm: '87163900',
    quantity: qty,
    unitPrice: opts.value,
    unit: 'UN',
    tax: {
      cfop: interstate ? '6101' : '5101',
      icmsCst: '00',
      icmsBase: total, icmsAliquota: icmsAliq, icmsValor: r2(total * icmsAliq / 100),
      ipiCst: '51', ipiBase: total, ipiAliquota: 0, ipiValor: 0,
      pisCst: '49', pisBase: total, pisAliquota: 0, pisValor: 0,
      cofinsCst: '99', cofinsBase: 0, cofinsAliquota: 0, cofinsValor: 0,
      ...(difal && { difal }),
      ...(ibs && { ibsCbs: ibs }),
    },
    vehicle: opts.withVehicle === false ? undefined : vehicle(),
  };
}

/** Item acessório comum (sem veículo) */
function acessorioItem(value: number, qty: number, ufDest: string): FiscalItem {
  const total = r2(qty * value);
  const it = reboqueItem({ value, qty, ufDest, consumidorFinal: true, withVehicle: false });
  return { ...it, sku: `ACC-AUD-${Date.now() % 10000}`, name: 'ENGATE RAPIDO TESTE AUDITORIA', ncm: '87169090', tax: { ...it.tax!, icmsBase: total } };
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* respostas sem corpo */ }
  return { http: res.status, data };
}

async function fetchXml(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: AUTH } });
  return res.text();
}

async function pollFinal(ref: string, maxS = 45): Promise<any> {
  for (let i = 0; i < maxS / 3; i++) {
    const { data } = await api('GET', `/v2/nfe/${ref}`);
    if (data?.status && data.status !== 'processando_autorizacao') return data;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { status: 'timeout' };
}

// ─── Checks ──────────────────────────────────────────────────────────────────
interface Check { name: string; ok: boolean; detail?: string }
interface Result { id: string; name: string; ref: string; status: string; sefaz?: string; msg?: string; chave?: string; checks: Check[] }
const results: Result[] = [];
const tag = (xml: string, t: string) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1];
const has = (xml: string, t: string) => xml.includes(`<${t}>`) || xml.includes(`<${t} `);

async function runScenario(
  id: string,
  name: string,
  payload: Record<string, unknown>,
  expect: {
    authorized?: boolean;
    veicProd?: boolean;
    ibscbs?: { vCBS: string; vIBSUF: string } | false;
    difal?: { vICMSUFDest: string } | false;
    fcpEsperado?: number;
    vNF?: string;
  },
): Promise<Result> {
  const ref = `GDR-AUD-${RUN}-${id}`;
  console.log(`\n▶ [${id}] ${name} (ref ${ref})`);
  const { data: emitData } = await api('POST', `/v2/nfe?ref=${ref}`, payload);
  const data = emitData?.status === 'processando_autorizacao' ? await pollFinal(ref) : emitData;
  const checks: Check[] = [];
  const status = data?.status ?? 'erro';
  const authorized = status === 'autorizado';

  checks.push({
    name: expect.authorized === false ? 'rejeição esperada' : 'autorizada',
    ok: expect.authorized === false ? !authorized : authorized,
    detail: `${data?.status_sefaz ?? ''} ${data?.mensagem_sefaz ?? data?.mensagem ?? ''}`.trim().slice(0, 140),
  });

  if (authorized && data.caminho_xml_nota_fiscal) {
    const xml = await fetchXml(data.caminho_xml_nota_fiscal);
    if (expect.veicProd !== undefined) {
      checks.push({ name: 'veicProd no XML', ok: has(xml, 'veicProd') === expect.veicProd, detail: has(xml, 'veicProd') ? `chassi ${tag(xml, 'chassi')}` : 'ausente' });
    }
    if (expect.ibscbs === false) {
      checks.push({ name: 'sem IBSCBS', ok: !has(xml, 'IBSCBS') });
    } else if (expect.ibscbs) {
      const ok = tag(xml, 'vCBS') === expect.ibscbs.vCBS && tag(xml, 'vIBSUF') === expect.ibscbs.vIBSUF;
      checks.push({ name: 'IBS/CBS valores', ok, detail: `vCBS=${tag(xml, 'vCBS')} vIBSUF=${tag(xml, 'vIBSUF')} (esperado ${expect.ibscbs.vCBS}/${expect.ibscbs.vIBSUF})` });
    }
    if (expect.difal === false) {
      checks.push({ name: 'sem ICMSUFDest', ok: !has(xml, 'ICMSUFDest') });
    } else if (expect.difal) {
      checks.push({ name: 'DIFAL no XML', ok: tag(xml, 'vICMSUFDest') === expect.difal.vICMSUFDest, detail: `vICMSUFDest=${tag(xml, 'vICMSUFDest')} (esperado ${expect.difal.vICMSUFDest})` });
    }
    if (expect.fcpEsperado !== undefined) {
      const pFcp = Number(tag(xml, 'pFCPUFDest') ?? 0);
      checks.push({
        name: `FCP UF destino (regra de negócio: ${expect.fcpEsperado}%)`,
        ok: pFcp === expect.fcpEsperado,
        detail: `XML envia pFCPUFDest=${pFcp}% — NF-e real #14236 usa 2% p/ SP`,
      });
    }
    if (expect.vNF) {
      checks.push({ name: 'total da nota (vNF)', ok: tag(xml, 'vNF') === expect.vNF, detail: `vNF=${tag(xml, 'vNF')} (esperado ${expect.vNF})` });
    }
  }

  const res: Result = { id, name, ref, status, sefaz: data?.status_sefaz, msg: (data?.mensagem_sefaz ?? data?.mensagem ?? '').slice(0, 160), chave: data?.chave_nfe, checks };
  results.push(res);
  for (const c of checks) console.log(`   ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  return res;
}

function nfe(input: FiscalPayloadInput): Record<string, unknown> {
  return buildNFePayload(input);
}

// ─── Suite ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`╔══ AUDITORIA HOMOLOGAÇÃO — run ${RUN} ══╗`);

  const base = (uf: string, value: number, opts: Partial<Parameters<typeof reboqueItem>[0]> = {}): FiscalPayloadInput => {
    const item = reboqueItem({ value, ufDest: uf, consumidorFinal: true, ...opts });
    return {
      ref: '', emitter, recipient: recipientPF(uf), items: [item],
      totalValue: r2((item.quantity) * item.unitPrice), consumidorFinal: true,
      infCpl: `Auditoria homologacao. Veiculo: chassi ${item.vehicle?.chassi ?? 'n/a'}`,
    };
  };
  const cbs = (v: number) => r2(v * 0.9 / 100).toFixed(2);
  const ibsUf = (v: number) => r2(v * 0.1 / 100).toFixed(2);
  const difalV = (v: number, interna: number) => r2(v * (interna - 12) / 100).toFixed(2);

  // ── Bloco A — Geografia / DIFAL ──
  const a1 = await runScenario('A1', 'Venda interna PR→PR (PF, sem DIFAL)', nfe(base('PR', 45000)),
    { veicProd: true, ibscbs: { vCBS: cbs(45000), vIBSUF: ibsUf(45000) }, difal: false, vNF: '45000.00' });
  await runScenario('A2', 'PR→SP consumidor final (DIFAL 18% + FCP esperado 2%)', nfe(base('SP', 45000)),
    { veicProd: true, difal: { vICMSUFDest: difalV(45000, 18) }, fcpEsperado: 2 });
  const a3 = await runScenario('A3', 'PR→MG consumidor final (DIFAL 18%)', nfe(base('MG', 38000)),
    { veicProd: true, difal: { vICMSUFDest: difalV(38000, 18) } });
  const a4 = await runScenario('A4', 'PR→RS consumidor final (DIFAL 17%)', nfe(base('RS', 27500)),
    { veicProd: true, difal: { vICMSUFDest: difalV(27500, 17) } });
  await runScenario('A5', 'PR→RJ consumidor final (DIFAL 20% + FCP esperado 2%)', nfe(base('RJ', 52000)),
    { veicProd: true, difal: { vICMSUFDest: difalV(52000, 20) }, fcpEsperado: 2 });

  // ── Bloco B — Tipo de destinatário ──
  const pjContrib = {
    ...base('SC', 45000, { consumidorFinal: false, contribuinte: true }),
    recipient: { name: 'REVENDA REBOQUES SC LTDA', document: '11.444.777/0001-61', ie: '251083110', address: 'RUA DAS REVENDAS', number: '500', neighborhood: 'CENTRO', city: 'FLORIANOPOLIS', state: 'SC', zipCode: '88010-000' },
    consumidorFinal: false,
  };
  await runScenario('B1', 'PJ contribuinte com IE (SC — sem DIFAL, indIEDest=1)', nfe(pjContrib), { veicProd: true, difal: false });
  const pjIsenta = {
    ...base('SC', 45000, { consumidorFinal: false }),
    recipient: { name: 'EMPRESA ISENTA SC LTDA', document: '11.444.777/0001-61', address: 'RUA DAS EMPRESAS', number: '600', neighborhood: 'CENTRO', city: 'FLORIANOPOLIS', state: 'SC', zipCode: '88010-000' },
    consumidorFinal: false,
  };
  await runScenario('B2', 'PJ sem IE (SC — indIEDest=2, sem DIFAL)', nfe(pjIsenta), { veicProd: true, difal: false });

  // ── Bloco C — Composição da nota ──
  const multiRbq = reboqueItem({ value: 12345.67, ufDest: 'PR', consumidorFinal: true });
  const multiAcc = acessorioItem(89.9, 3, 'PR');
  const multiTotal = r2(12345.67 + 3 * 89.9);
  await runScenario('C1', 'Multi-item: reboque + 3 acessórios (PR)', nfe({
    ref: '', emitter, recipient: recipientPF('PR'), items: [multiRbq, multiAcc], totalValue: multiTotal, consumidorFinal: true,
  }), { veicProd: true, vNF: multiTotal.toFixed(2) });
  await runScenario('C2', 'Item comum sem grupo veículo (PR)', nfe({
    ref: '', emitter, recipient: recipientPF('PR'), items: [acessorioItem(450, 1, 'PR')], totalValue: 450, consumidorFinal: true,
  }), { veicProd: false, vNF: '450.00' });
  const roundTotal = r2(3 * 1234.56);
  await runScenario('C3', 'Arredondamento: 3 × R$1.234,56 PR→SC (DIFAL)', nfe(base('SC', 1234.56, { qty: 3 })),
    { difal: { vICMSUFDest: difalV(roundTotal, 17) }, ibscbs: { vCBS: cbs(roundTotal), vIBSUF: ibsUf(roundTotal) }, vNF: roundTotal.toFixed(2) });
  const descPayload = nfe(base('PR', 45000)) as any;
  descPayload.items[0].valor_desconto = 500;
  await runScenario('C4', 'Item com desconto R$500 (PR)', descPayload, { vNF: '44500.00' });

  // ── Bloco D — Ciclo de vida ──
  const transferItem = reboqueItem({ value: 30000, ufDest: 'SC', consumidorFinal: false, contribuinte: true });
  transferItem.tax!.cfop = '6152';
  await runScenario('D1', 'Transferência entre estabelecimentos (6152)', buildTransferNFePayload({
    ref: '', emitter,
    recipient: { name: 'GDR FILIAL SC', document: '11.444.777/0001-61', ie: '251083110', address: 'ROD BR 101', number: 'KM 10', neighborhood: 'DISTRITO', city: 'FLORIANOPOLIS', state: 'SC', zipCode: '88010-000' },
    items: [transferItem], totalValue: 30000,
  }), { veicProd: true });

  if (a1.chave) {
    const devPayload = nfe({
      ref: '', emitter, recipient: recipientPF('PR'),
      items: [(() => { const i = reboqueItem({ value: 45000, ufDest: 'PR', consumidorFinal: true, withVehicle: false, ibsCbs: true }); i.tax!.cfop = '1202'; return i; })()],
      totalValue: 45000, consumidorFinal: true, infCpl: 'Devolucao de venda — auditoria',
      paymentMethod: '90', // devolução/entrada exige Sem Pagamento (rej 871)
    }) as any;
    devPayload.natureza_operacao = 'DEVOLUCAO DE VENDA';
    devPayload.tipo_documento = '0';
    devPayload.finalidade_emissao = '4';
    devPayload.notas_referenciadas = [{ chave_nfe: a1.chave.replace(/^NFe/, '') }];
    await runScenario('D2', 'Devolução de venda (entrada 1202, finalidade 4, ref A1)', devPayload, {});
  }

  // ── Bloco E — IBS/CBS variações ──
  await runScenario('E1', 'cClassTrib 200003 (CST 200 — redução) sem gRed: mapper suporta?',
    nfe(base('PR', 45000, { ibsCbs: { cst: '200', cClassTrib: '200003' } })), {});
  const mixed = nfe({
    ref: '', emitter, recipient: recipientPF('PR'),
    items: [reboqueItem({ value: 20000, ufDest: 'PR', consumidorFinal: true }), (() => { const i = acessorioItem(100, 1, 'PR'); delete (i.tax as any).ibsCbs; return i; })()],
    totalValue: 20100, consumidorFinal: true,
  });
  await runScenario('E2', 'Item com IBS/CBS + item sem (mix)', mixed, { vNF: '20100.00' });

  // ── Bloco F — Cancelamento com retorno para o sistema ──
  if (a3.status === 'autorizado') {
    console.log(`\n▶ [F1] Cancelamento da nota A3 (${a3.ref})`);
    const { http, data: cancelData } = await api('DELETE', `/v2/nfe/${a3.ref}`, { justificativa: 'Cancelamento de teste da auditoria de homologacao do ERP Avequi' });
    const after = await pollFinal(a3.ref);
    const checks: Check[] = [
      { name: 'DELETE aceito', ok: http === 200, detail: `HTTP ${http} ${cancelData?.status ?? ''}` },
      { name: 'status → cancelado (mapeia p/ CANCELLED no webhook)', ok: after.status === 'cancelado', detail: `status=${after.status}` },
      { name: 'XML de cancelamento disponível', ok: !!after.caminho_xml_cancelamento, detail: after.caminho_xml_cancelamento ?? 'ausente' },
      { name: 'campos p/ applyFocusResponse presentes (chave/numero/serie)', ok: !!after.chave_nfe && !!after.numero && !!after.serie, detail: `numero=${after.numero} serie=${after.serie}` },
    ];
    if (after.caminho_xml_cancelamento) {
      const xmlCanc = await fetchXml(after.caminho_xml_cancelamento);
      checks.push({ name: 'protocolo de cancelamento (nProt) no XML', ok: /<nProt>\d+<\/nProt>/.test(xmlCanc), detail: xmlCanc.match(/<nProt>(\d+)</)?.[1] });
    }
    results.push({ id: 'F1', name: 'Cancelamento com verificação de retorno', ref: a3.ref, status: after.status, sefaz: after.status_sefaz, msg: after.mensagem_sefaz ?? '', chave: after.chave_nfe, checks });
    for (const c of checks) console.log(`   ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }

  // ── F2 — CC-e na nota A4 ──
  if (a4.status === 'autorizado') {
    console.log(`\n▶ [F2] Carta de correção na nota A4 (${a4.ref})`);
    const { http, data: cce } = await api('POST', `/v2/nfe/${a4.ref}/carta_correcao`, { correcao: 'Correcao de teste da auditoria: complemento do endereco de entrega Pavilhao B' });
    const checks: Check[] = [
      { name: 'CC-e aceita', ok: http === 200 || http === 201, detail: `HTTP ${http} ${cce?.status ?? cce?.mensagem ?? ''}`.slice(0, 120) },
      { name: 'XML da CC-e disponível', ok: !!(cce?.caminho_xml_carta_correcao), detail: cce?.caminho_xml_carta_correcao ?? 'ausente' },
    ];
    results.push({ id: 'F2', name: 'Carta de correção (CC-e)', ref: a4.ref, status: cce?.status ?? `http${http}`, msg: (cce?.mensagem_sefaz ?? cce?.mensagem ?? '').slice(0, 160), checks });
    for (const c of checks) console.log(`   ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }

  // ── Relatório ──
  const okCount = results.filter((r) => r.checks.every((c) => c.ok)).length;
  const failures = results.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => ({ id: r.id, name: r.name, check: c })));
  const lines: string[] = [
    `# Auditoria de Homologação — Faturamento NF-e`,
    ``,
    `**Data:** ${new Date().toISOString()} · **Run:** ${RUN} · **Ambiente:** homologação Focus/SEFAZ-PR`,
    ``,
    `**Resultado:** ${okCount}/${results.length} cenários 100% OK · ${failures.length} checks falhando`,
    ``,
    `| # | Cenário | Status | SEFAZ | Checks |`,
    `|---|---------|--------|-------|--------|`,
    ...results.map((r) => `| ${r.id} | ${r.name} | ${r.status} | ${r.sefaz ?? '—'} | ${r.checks.map((c) => c.ok ? '✅' : '❌').join(' ')} |`),
    ``,
    `## Detalhes por cenário`,
    ``,
  ];
  for (const r of results) {
    lines.push(`### ${r.id} — ${r.name}`);
    lines.push(`- ref: \`${r.ref}\` · status: **${r.status}** ${r.sefaz ? `(SEFAZ ${r.sefaz})` : ''}${r.chave ? ` · chave \`${r.chave}\`` : ''}`);
    if (r.msg) lines.push(`- msg: ${r.msg}`);
    for (const c of r.checks) lines.push(`- ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    lines.push('');
  }
  if (failures.length) {
    lines.push(`## ⚠️ Achados (checks falhando)`, ``);
    for (const f of failures) lines.push(`- **[${f.id}] ${f.name}** → ${f.check.name}${f.check.detail ? ` — ${f.check.detail}` : ''}`);
  }
  const out = `${process.cwd()}/audit-homologacao-${RUN}.md`;
  writeFileSync(out, lines.join('\n'));
  console.log(`\n📄 Relatório: ${out}`);
  console.log(`\n══ RESUMO: ${okCount}/${results.length} cenários OK · ${failures.length} checks falhando ══`);
}

main().catch((e) => { console.error(e); process.exit(1); });
