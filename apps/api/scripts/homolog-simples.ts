/**
 * Homologação SEFAZ — emitente do Simples Nacional (CRT=1), épico #1068.
 *
 * A matriz do audit-homologacao.ts é toda da GDR (CRT=3). Este script prova o
 * caminho novo: grupo ICMSSN com CSOSN, e o crédito repassado ao destinatário.
 *
 * Emitente real: USINAGEM J A LTDA — exige o certificado A1 dela cadastrado no
 * ambiente de HOMOLOGAÇÃO da Focus. Sem isso a Focus recusa antes de emitir.
 *
 * Uso: npx tsx apps/api/scripts/homolog-simples.ts
 */

import { writeFileSync } from 'fs';
import { buildNFePayload, FiscalPayloadInput } from '../src/modules/fiscal/fiscal-mapper';

const FOCUS_TOKEN = process.env.FOCUS_NFE_TOKEN ?? '';
// Trava de segurança: este script NUNCA fala com produção.
const BASE = 'https://homologacao.focusnfe.com.br';
if (!FOCUS_TOKEN) {
  console.error('FOCUS_NFE_TOKEN não definido');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${FOCUS_TOKEN}:`).toString('base64');
const RUN = Date.now();

// ─── Emitente — dados do Cartão CNPJ + SINTEGRA/PR (12/08/2026) ──────────────
const emitter = {
  cnpj: '62.484.006/0001-39',
  name: 'USINAGEM J A LTDA',
  ie: '9124135785', // 91241357-85 sem separador — IE do PR tem 10 dígitos (8 + 2 verificadores)
  crt: 1, // Simples Nacional — o ponto inteiro deste teste
  address: 'RUA NESTOR NEGOSEKE',
  number: '110',
  neighborhood: 'CAMPINA DOS FURTADOS',
  city: 'SAO JOSE DOS PINHAIS',
  state: 'PR',
  zipCode: '83161-000',
  ibgeCode: '4125506', // São José dos Pinhais
  phone: '4199623775',
};

/**
 * Destinatário real da operação: a CRD compra a peça usinada para o processo
 * produtivo dela. Dados puxados do cadastro do ERP (onboarding de 13/07).
 *
 * É PJ CONTRIBUINTE (CRT=3, IE ativa) — o que torna o CSOSN 101 (com crédito)
 * válido aqui. Com PF consumidor final a SEFAZ devolve rejeição 600.
 */
const CRD = {
  name: 'CRD INDUSTRIA E COMERCIO DE REBOQUES LTDA',
  document: '30.284.708/0001-82',
  ie: '9078144677',
  address: 'RUA ANTONIO SINGER',
  number: '4075',
  neighborhood: 'CAMPO LARGO DA ROSEIRA',
  city: 'SAO JOSE DOS PINHAIS',
  state: 'PR',
  zipCode: '83091-002',
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Ponta de eixo — 1º produto da cliente.
 *
 * Ela COMPRA o material e entrega a peça pronta, então é venda de produção
 * própria (CFOP 5101), não industrialização por encomenda (que seria 5124/5902
 * e exigiria a CRD remeter o insumo). Por isso sai NF-e de mercadoria com ICMS,
 * e não NFS-e — a decisão ISS × ICMS é por operação, e esta caiu no ICMS.
 */
function pecaUsinada(opts: {
  value: number;
  qty?: number;
  cfop: string;
  csosn: string;
  credAliq?: number;
}) {
  const qty = opts.qty ?? 2;
  const total = r2(qty * opts.value);
  return {
    sku: `PONTA-EIXO-${RUN % 10000}`,
    name: 'PONTA DE EIXO',
    ncm: '87169090', // 8716.90.90 — outras partes de reboques e semirreboques
    quantity: qty,
    unitPrice: opts.value,
    unit: 'UN',
    origem: '0', // mercadoria nacional
    // CEST 01.127.00 — segmento 01 (autopeças). O cEST é obrigatório quando o
    // produto CONSTA na lista de ST, mesmo que a ST não se aplique nesta
    // operação: ele identifica a mercadoria, o CSOSN é que diz como foi
    // tributada aqui. Ver nota sobre ST no rodapé deste arquivo.
    cest: '0112700',
    tax: {
      cfop: opts.cfop,
      icmsCst: '90', // placeholder — o mapper dá precedência ao CSOSN
      icmsCsosn: opts.csosn,
      icmsBase: total,
      icmsAliquota: 0, // Simples recolhe no DAS, não destaca
      icmsValor: 0,
      ...(opts.credAliq != null && {
        icmsCredSNAliquota: opts.credAliq,
        icmsCredSNValor: r2((total * opts.credAliq) / 100),
      }),
      // Optante do Simples não destaca federal
      ipiCst: '53', ipiBase: 0, ipiAliquota: 0, ipiValor: 0,
      pisCst: '49', pisBase: 0, pisAliquota: 0, pisValor: 0,
      cofinsCst: '49', cofinsBase: 0, cofinsAliquota: 0, cofinsValor: 0,
    },
  };
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
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

interface Check { name: string; ok: boolean; detail?: string }
interface Result { id: string; name: string; ref: string; status: string; sefaz?: string; msg?: string; chave?: string; checks: Check[] }
const results: Result[] = [];

async function runScenario(
  id: string,
  name: string,
  input: FiscalPayloadInput,
  expect: { csosn: string; credito?: { pCredSN: string; vCredICMSSN: string } },
): Promise<Result> {
  const ref = `USIJA-HOM-${RUN}-${id}`;
  console.log(`\n▶ [${id}] ${name} (ref ${ref})`);
  const payload = buildNFePayload({ ...input, ref });
  const { data: emitData } = await api('POST', `/v2/nfe?ref=${ref}`, payload);
  const data = emitData?.status === 'processando_autorizacao' ? await pollFinal(ref) : emitData;
  const status = data?.status ?? 'erro';
  const authorized = status === 'autorizado';
  const checks: Check[] = [
    {
      name: 'autorizada',
      ok: authorized,
      detail: `${data?.status_sefaz ?? ''} ${data?.mensagem_sefaz ?? data?.mensagem ?? ''}`.trim().slice(0, 200),
    },
  ];

  if (authorized && data.caminho_xml_nota_fiscal) {
    const xml = await fetchXml(data.caminho_xml_nota_fiscal);
    checks.push({ name: 'CRT=1 no XML', ok: tag(xml, 'CRT') === '1', detail: `CRT=${tag(xml, 'CRT')}` });
    checks.push({ name: `CSOSN ${expect.csosn}`, ok: tag(xml, 'CSOSN') === expect.csosn, detail: `CSOSN=${tag(xml, 'CSOSN')}` });

    // Escopa no grupo <ICMS> do item: CST existe em PIS/COFINS e vICMS existe
    // no ICMSTot, então checar o XML inteiro daria falso negativo sempre.
    const grupoIcms = xml.match(/<ICMS>[\s\S]*?<\/ICMS>/)?.[0] ?? '';
    checks.push({
      name: 'grupo ICMS do item é ICMSSN (sem CST)',
      ok: grupoIcms.includes('ICMSSN') && !grupoIcms.includes('<CST>'),
      detail: grupoIcms.match(/<(ICMSSN\d+|ICMS\d+)>/)?.[1] ?? 'grupo não encontrado',
    });

    if (expect.credito) {
      checks.push({ name: 'pCredSN', ok: tag(xml, 'pCredSN') === expect.credito.pCredSN, detail: `pCredSN=${tag(xml, 'pCredSN')}` });
      checks.push({ name: 'vCredICMSSN', ok: tag(xml, 'vCredICMSSN') === expect.credito.vCredICMSSN, detail: `vCredICMSSN=${tag(xml, 'vCredICMSSN')}` });
    } else {
      checks.push({ name: 'sem crédito (CSOSN não permite)', ok: !has(xml, 'vCredICMSSN'), detail: has(xml, 'vCredICMSSN') ? 'PRESENTE — não deveria' : 'ausente' });
      checks.push({
        name: 'sem vICMS dentro do grupo do item',
        ok: !grupoIcms.includes('<vICMS>'),
        detail: grupoIcms.includes('<vICMS>') ? 'PRESENTE — ICMSSN 102 não aceita' : 'ausente',
      });
    }
  }

  const r: Result = {
    id, name, ref, status,
    sefaz: data?.status_sefaz,
    msg: data?.mensagem_sefaz ?? data?.mensagem ?? data?.erros?.[0]?.mensagem,
    chave: data?.chave_nfe,
    checks,
  };
  results.push(r);
  for (const c of checks) console.log(`   ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  return r;
}

// ─── Cenários ────────────────────────────────────────────────────────────────
(async () => {
  console.log(`╔══ HOMOLOGAÇÃO SIMPLES NACIONAL — ${emitter.name} (CRT=1) — run ${RUN} ══╗`);
  console.log(`   ambiente: ${BASE}`);

  const VALOR_UNITARIO = 17; // R$ 17,00 por unidade
  const QTD = 100;

  const venda = (cfop: string, csosn: string, credAliq?: number): FiscalPayloadInput => {
    const item = pecaUsinada({ value: VALOR_UNITARIO, qty: QTD, cfop, csosn, credAliq });
    const total = r2(item.quantity * item.unitPrice);
    return {
      ref: '',
      emitter,
      recipient: CRD,
      items: [item],
      totalValue: total,
      // Venda a prazo, 4x de 7 em 7 dias. tPag 15 = boleto (padrão B2B).
      // ⚠️ O detPag carrega a FORMA, não os VENCIMENTOS: o grupo de cobrança
      // (cobr/dup) não existe no mapper hoje, então as datas das 4 parcelas
      // não vão no XML. A SEFAZ aceita (cobr é opcional), mas o contas a pagar
      // da CRD não recebe o cronograma pela nota. Registrado como gap.
      payments: [{ tPag: '15', amount: total }],
      // A CRD compra para INDUSTRIALIZAR, não para consumo: não é consumidor
      // final, e é contribuinte de ICMS — sem isso o CSOSN 101 cai na rej. 600.
      consumidorFinal: false,
      contribuinte: true,
      infCpl: 'Homologacao Simples Nacional - epico 1068. SEM VALOR FISCAL.',
    } as FiscalPayloadInput;
  };

  // S1 — O CENÁRIO REAL, definido pela contadora em 19/08: CSOSN 102.
  //
  // A CRD não vai aproveitar crédito de ICMS, então o 101 seria pior em todos
  // os sentidos: exigiria um pCredSN que ninguém validou, e o crédito
  // destacado é escriturado pelo destinatário — errar para mais é crédito
  // indevido tomado pela CRD. Com 102 não há campo, número nem risco.
  await runScenario('S1', 'Venda PR→PR para a CRD — CSOSN 102 (caso real)',
    venda('5101', '102'), { csosn: '102' });

  // S2 — cobertura do motor, não a operação real. Mantém provado que o grupo
  // ICMSSN101 sai com pCredSN/vCredICMSSN corretos, caso algum cliente futuro
  // dela precise de repasse de crédito. O percentual aqui é arbitrário e serve
  // só para verificar a forma do XML.
  const P_CRED_SN = Number(process.env.P_CRED_SN ?? 1.44);
  const credEsperado = r2((VALOR_UNITARIO * QTD * P_CRED_SN) / 100).toFixed(2);
  await runScenario('S2', `Cobertura do motor — CSOSN 101 com crédito ${P_CRED_SN}% (não é a operação real)`,
    venda('5101', '101', P_CRED_SN),
    { csosn: '101', credito: { pCredSN: P_CRED_SN.toFixed(4), vCredICMSSN: credEsperado } });

  // ── Relatório ──
  const ok = results.filter((r) => r.checks.every((c) => c.ok)).length;
  console.log(`\n╚══ ${ok}/${results.length} cenários 100% OK ══╝`);

  const md = [
    `# Homologação SEFAZ — Simples Nacional (CRT=1)`,
    ``,
    `**Data:** ${new Date().toISOString()} · **Run:** ${RUN} · **Épico:** #1068`,
    `**Emitente:** ${emitter.name} — CNPJ ${emitter.cnpj} · IE ${emitter.ie} · CRT ${emitter.crt}`,
    `**Ambiente:** ${BASE}`,
    ``,
    `## Resultado: ${ok}/${results.length} cenários 100% OK`,
    ``,
    `| # | Cenário | Status | SEFAZ | Chave |`,
    `|---|---------|--------|-------|-------|`,
    ...results.map((r) => `| ${r.id} | ${r.name} | ${r.checks.every((c) => c.ok) ? '✅' : '❌'} ${r.status} | ${r.sefaz ?? ''} ${(r.msg ?? '').slice(0, 60)} | ${r.chave ?? ''} |`),
    ``,
    `## Detalhe`,
    ``,
    ...results.flatMap((r) => [
      `### ${r.id} — ${r.name}`,
      ``,
      `\`ref\`: ${r.ref} · status: **${r.status}** ${r.chave ? `· chave: \`${r.chave}\`` : ''}`,
      r.msg ? `\nSEFAZ: ${r.sefaz ?? ''} — ${r.msg}` : '',
      ``,
      ...r.checks.map((c) => `- ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — \`${c.detail}\`` : ''}`),
      ``,
    ]),
  ].join('\n');

  const out = `docs/faturamento/homologacao-simples-nacional-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(out, md);
  console.log(`\n📄 relatório: ${out}`);
  process.exit(results.every((r) => r.checks.every((c) => c.ok)) ? 0 : 1);
})();
