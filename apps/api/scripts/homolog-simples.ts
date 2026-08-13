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
  ie: '912413578', // 91241357-85 sem o separador; SINTEGRA exibe com dígito
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

const recipientPF = (uf: string, city: string, cep: string) => ({
  name: 'CLIENTE PF TESTE',
  document: '030.550.549-11',
  address: 'RUA DOS TESTES',
  number: '100',
  neighborhood: 'CENTRO',
  city,
  state: uf,
  zipCode: cep,
});

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Item de usinagem — CNAE principal dela é serviço de usinagem/tornearia/solda. */
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
    sku: `USI-${RUN % 10000}`,
    name: 'PECA USINADA SOB ENCOMENDA - ACO 1045',
    ncm: '73269090', // outras obras de ferro ou aço
    quantity: qty,
    unitPrice: opts.value,
    unit: 'PC',
    origem: '0',
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
    // O grupo ICMSSN não pode carregar CST — se vier, o branch de regime vazou
    checks.push({ name: 'sem CST no grupo ICMS', ok: !has(xml, 'CST'), detail: has(xml, 'CST') ? `CST=${tag(xml, 'CST')}` : 'ausente' });

    if (expect.credito) {
      checks.push({ name: 'pCredSN', ok: tag(xml, 'pCredSN') === expect.credito.pCredSN, detail: `pCredSN=${tag(xml, 'pCredSN')}` });
      checks.push({ name: 'vCredICMSSN', ok: tag(xml, 'vCredICMSSN') === expect.credito.vCredICMSSN, detail: `vCredICMSSN=${tag(xml, 'vCredICMSSN')}` });
    } else {
      checks.push({ name: 'sem crédito (CSOSN não permite)', ok: !has(xml, 'vCredICMSSN'), detail: has(xml, 'vCredICMSSN') ? 'PRESENTE — não deveria' : 'ausente' });
      checks.push({ name: 'sem vICMS no ICMSSN', ok: !has(xml, 'vICMS'), detail: has(xml, 'vICMS') ? `vICMS=${tag(xml, 'vICMS')}` : 'ausente' });
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

  const venda = (uf: string, city: string, cep: string, cfop: string, csosn: string, credAliq?: number): FiscalPayloadInput => {
    const item = pecaUsinada({ value: 500, cfop, csosn, credAliq });
    return {
      ref: '',
      emitter,
      recipient: recipientPF(uf, city, cep),
      items: [item],
      totalValue: r2(item.quantity * item.unitPrice),
      consumidorFinal: true,
      infCpl: 'Homologacao Simples Nacional - epico 1068. SEM VALOR FISCAL.',
    };
  };

  // S1 — o caso base: CSOSN 102, sem crédito
  await runScenario('S1', 'Venda interna PR→PR — CSOSN 102 (sem crédito)',
    venda('PR', 'CURITIBA', '80010-000', '5101', '102'), { csosn: '102' });

  // S2 — o que vale dinheiro pra ela: crédito repassado ao cliente industrial
  await runScenario('S2', 'Venda interna PR→PR — CSOSN 101 com crédito 2,5%',
    venda('PR', 'CURITIBA', '80010-000', '5101', '101', 2.5),
    { csosn: '101', credito: { pCredSN: '2.5000', vCredICMSSN: '25.00' } });

  // S3 — interestadual
  await runScenario('S3', 'Venda interestadual PR→SP — CSOSN 102',
    venda('SP', 'SAO PAULO', '01001-000', '6101', '102'), { csosn: '102' });

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
