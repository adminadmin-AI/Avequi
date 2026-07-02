/**
 * Script de teste E2E — Emissão NF-e via Focus NFe (Homologação)
 *
 * Monta o payload idêntico ao fiscal-mapper.ts e dispara direto na API Focus.
 * Não depende da stack rodando (sem NestJS, sem Prisma, sem Redis).
 *
 * Uso: npx tsx apps/api/scripts/test-focus-e2e.ts
 */

import { buildNFePayload, FiscalPayloadInput } from '../src/modules/fiscal/fiscal-mapper';

const FOCUS_TOKEN = process.env.FOCUS_NFE_TOKEN ?? '';
const FOCUS_BASE_URL = process.env.FOCUS_NFE_BASE_URL ?? 'https://homologacao.focusnfe.com.br';
if (!FOCUS_TOKEN) {
  console.error('FOCUS_NFE_TOKEN não definido — configure no .env ou exporte a variável');
  process.exit(1);
}

// ─── Dados GDR Matriz (emitente) ───────────────────────────────────────────
const emitter = {
  cnpj: '46.247.069/0001-15',
  name: 'GDR INDUSTRIA E COMERCIO DE REBOQUES LTDA',
  ie: '9095313067',
  crt: 3, // Lucro Presumido
  address: 'RUA FRANCISCO STRAPASSON',
  number: '303',
  complement: 'PAVILHAO A',
  neighborhood: 'BORDA DO CAMPO',
  city: 'SAO JOSE DOS PINHAIS',
  state: 'PR',
  zipCode: '83045-090',
  ibgeCode: '4125506',
  phone: '4130853400',
};

// ─── Destinatário teste (empresa SC — interestadual p/ testar DIFAL) ───────
const recipient = {
  name: 'CLIENTE CONSUMIDOR FINAL TESTE',
  document: '030.550.549-11', // CPF de teste — consumidor final não contribuinte (cenário DIFAL, NF-e real #14236)
  address: 'RUA DOS TESTES',
  number: '100',
  neighborhood: 'CENTRO',
  city: 'FLORIANOPOLIS',
  state: 'SC',
  zipCode: '88010-000',
  ibgeCode: '4205407',
};

// ─── Item: Reboque GDR (NCM 8716.39.00) ───────────────────────────────────
// Simula venda interestadual PR→SC com DIFAL
const itemValue = 45000.0;
const icmsAliquota = 12; // interestadual PR→SC
const icmsBase = itemValue;
const icmsValor = Number((icmsBase * icmsAliquota / 100).toFixed(2));
const ipiAliquota = 0; // reboque IPI zero (CST 51)
const ipiBase = itemValue;
const ipiValor = 0;
const pisAliquota = 0.65;
const pisBase = itemValue;
const pisValor = Number((pisBase * pisAliquota / 100).toFixed(2));
const cofinsAliquota = 3;
const cofinsBase = itemValue;
const cofinsValor = Number((cofinsBase * cofinsAliquota / 100).toFixed(2));

// DIFAL: SC alíquota interna 17%, interestadual 12%
const difalBase = itemValue + ipiValor;
const difalAliqInterna = 17;
const difalAliqInterest = 12;
const difalValor = Number((difalBase * (difalAliqInterna - difalAliqInterest) / 100).toFixed(2));

const ref = `GDR-TEST-E2E-${Date.now()}`;

const input: FiscalPayloadInput = {
  ref,
  emitter,
  recipient,
  items: [
    {
      sku: 'RBQ-TESTE-001',
      name: 'REBOQUE BASCULANTE 6T - TESTE HOMOLOGACAO',
      ncm: '87163900',
      quantity: 1,
      unitPrice: itemValue,
      unit: 'UN',
      tax: {
        cfop: '6101',
        icmsCst: '00',
        icmsBase,
        icmsAliquota,
        icmsValor,
        ipiCst: '51',
        ipiBase,
        ipiAliquota,
        ipiValor,
        pisCst: '01',
        pisBase,
        pisAliquota,
        pisValor,
        cofinsCst: '01',
        cofinsBase,
        cofinsAliquota,
        cofinsValor,
        difal: {
          baseCalculo: difalBase,
          aliquotaInterna: difalAliqInterna,
          aliquotaInterestadual: difalAliqInterest,
          valor: difalValor,
        },
      },
      vehicle: {
        tipoOperacao: '0',
        chassi: '9BGRD08X0XG000001', // chassi fictício
        codigoCor: '09',
        descricaoCor: 'PRATA',
        potenciaMotor: 0,
        cilindrada: 0,
        pesoLiquido: '1.200',
        pesoBruto: '6.000',
        serie: 'SN-TESTE-001',
        tipoCombustivel: '11',
        numeroMotor: '0',
        cmt: '7.200',
        distanciaEixos: 0,
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
      },
    },
  ],
  totalValue: itemValue,
  consumidorFinal: true, // PF sem IE — indIEDest=9 (cenário DIFAL da NF-e real #14236)
  infCpl: `ICMS DIFAL recolhido: R$ ${difalValor.toFixed(2)} — EC 87/2015, 100% UF destino. Veículo: chassi 9BGRD08X0XG000001`,
};

// ─── Build payload usando o mesmo mapper do sistema ────────────────────────
const payload = buildNFePayload(input);

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  TESTE E2E — Emissão NF-e Focus NFe (Homologação)          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`📌 Ref: ${ref}`);
  console.log(`📌 Base URL: ${FOCUS_BASE_URL}`);
  console.log(`📌 Emitente: ${emitter.name} (${emitter.cnpj})`);
  console.log(`📌 Destinatário: ${recipient.name} (${recipient.document})`);
  console.log(`📌 Item: Reboque NCM ${input.items[0].ncm} — R$ ${itemValue.toFixed(2)}`);
  console.log(`📌 ICMS: ${icmsAliquota}% = R$ ${icmsValor.toFixed(2)}`);
  console.log(`📌 IPI: ${ipiAliquota}% = R$ ${ipiValor.toFixed(2)}`);
  console.log(`📌 PIS: ${pisAliquota}% = R$ ${pisValor.toFixed(2)}`);
  console.log(`📌 COFINS: ${cofinsAliquota}% = R$ ${cofinsValor.toFixed(2)}`);
  console.log(`📌 DIFAL: ${difalAliqInterna}% - ${difalAliqInterest}% = R$ ${difalValor.toFixed(2)}`);
  console.log(`📌 Veículo: chassi ${input.items[0].vehicle!.chassi}`);
  console.log();

  // Log do payload completo
  console.log('── Payload enviado para Focus ──');
  console.log(JSON.stringify(payload, null, 2));
  console.log();

  // Enviar para Focus NFe
  const url = `${FOCUS_BASE_URL}/v2/nfe?ref=${ref}`;
  console.log(`🚀 POST ${url}`);
  console.log();

  const authHeader = 'Basic ' + Buffer.from(`${FOCUS_TOKEN}:`).toString('base64');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    console.log(`── Resposta Focus (HTTP ${response.status}) ──`);
    console.log(JSON.stringify(data, null, 2));
    console.log();

    if (data.status === 'autorizado') {
      console.log('✅ NF-e AUTORIZADA!');
      console.log(`   Chave: ${data.chave_nfe}`);
    } else if (data.status === 'processando_autorizacao') {
      console.log('⏳ NF-e em PROCESSAMENTO — aguardar webhook ou consultar status');
      console.log(`   Consultar: GET ${FOCUS_BASE_URL}/v2/nfe/${ref}`);

      // Polling por até 30s
      console.log();
      console.log('── Polling status (máx 30s) ──');
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const statusUrl = `${FOCUS_BASE_URL}/v2/nfe/${ref}`;
        const statusRes = await fetch(statusUrl, {
          headers: { Authorization: authHeader },
        });
        const statusData = await statusRes.json();
        console.log(`[${(i + 1) * 5}s] Status: ${statusData.status} ${statusData.status === 'autorizado' ? '✅' : ''}`);

        if (statusData.status === 'autorizado') {
          console.log(`   Chave: ${statusData.chave_nfe}`);
          break;
        }
        if (statusData.status === 'rejeitado') {
          console.log(`   ❌ Rejeição: [${statusData.codigo}] ${statusData.motivo}`);
          break;
        }
        if (statusData.status === 'erro') {
          console.log(`   ❌ Erro: ${statusData.motivo}`);
          break;
        }
      }
    } else if (data.status === 'rejeitado' || data.status_sefaz === 'rejeitado') {
      const code = data.codigo || data.codigo_sefaz || data.status_sefaz;
      const reason = data.motivo || data.motivo_sefaz || data.mensagem_sefaz;
      console.log(`❌ NF-e REJEITADA: [${code}] ${reason}`);
    } else if (data.status === 'erro') {
      console.log(`❌ ERRO: ${data.motivo || data.mensagem}`);
    } else {
      console.log(`⚠️  Status inesperado: ${data.status || JSON.stringify(data)}`);
    }
  } catch (err: any) {
    console.error(`❌ Erro de conexão: ${err.message}`);
  }
}

main().catch(console.error);
