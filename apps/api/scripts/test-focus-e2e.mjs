/**
 * Teste E2E — Emissão NF-e via Focus NFe (Homologação)
 *
 * Payload montado idêntico ao buildNFePayload() do fiscal-mapper.ts.
 * Testa: dados emitente/destinatário, NCM reboque, DIFAL, PIS/COFINS, grupo veículo, infCpl.
 *
 * Uso: node apps/api/scripts/test-focus-e2e.mjs
 */

const FOCUS_TOKEN = process.env.FOCUS_NFE_TOKEN ?? '';
const FOCUS_BASE_URL = process.env.FOCUS_NFE_BASE_URL ?? 'https://homologacao.focusnfe.com.br';
if (!FOCUS_TOKEN) {
  console.error('FOCUS_NFE_TOKEN não definido — configure no .env ou exporte a variável');
  process.exit(1);
}

const ref = `GDR-TEST-E2E-${Date.now()}`;

// Valores tributários
const itemValue = 45000.00;
const icmsAliq = 12;
const icmsVal = +(itemValue * icmsAliq / 100).toFixed(2);   // 5400.00
const pisAliq = 0.65;
const pisVal = +(itemValue * pisAliq / 100).toFixed(2);      // 292.50
const cofinsAliq = 3;
const cofinsVal = +(itemValue * cofinsAliq / 100).toFixed(2); // 1350.00
const difalAliqInt = 17;
const difalVal = +(itemValue * (difalAliqInt - icmsAliq) / 100).toFixed(2); // 2250.00

// Payload idêntico ao output de buildNFePayload()
const payload = {
  natureza_operacao: 'VENDA DE PRODUÇÃO PRÓPRIA',
  forma_pagamento: 0,
  modalidade_frete: '9',
  indicador_consumidor_final: '1',
  informacoes_adicionais_contribuinte: `ICMS DIFAL recolhido: R$ ${difalVal.toFixed(2)} — EC 87/2015, 100% UF destino. Veículo: chassi 9BGRD08X0XG000001`,
  emitente: {
    cnpj: '46247069000115',
    nome: 'GDR INDUSTRIA DE REBOQUES LTDA',
    inscricao_estadual: '9095313067',
    regime_tributario: 3,
    logradouro: 'RUA FRANCISCO STRAPASSON',
    numero: '303',
    complemento: 'PAVILHAO A',
    bairro: 'BORDA DO CAMPO',
    municipio: 'SAO JOSE DOS PINHAIS',
    uf: 'PR',
    cep: '83045090',
    codigo_municipio: '4125506',
    telefone: '4130853400',
  },
  destinatario: {
    nome: 'EMPRESA TESTE LTDA',
    cpf_cnpj: '11222333000181',
    indicador_inscricao_estadual_destinatario: '9',
    logradouro: 'RUA DOS TESTES',
    numero: '100',
    bairro: 'CENTRO',
    municipio: 'FLORIANOPOLIS',
    uf: 'SC',
    cep: '88010000',
    codigo_municipio: '4205407',
  },
  items: [
    {
      numero_item: 1,
      codigo_produto: 'RBQ-TESTE-001',
      descricao: 'REBOQUE BASCULANTE 6T - TESTE HOMOLOGACAO',
      cfop: '6101',
      unidade_comercial: 'UN',
      quantidade_comercial: 1,
      valor_unitario_comercial: itemValue,
      valor_total_bruto: itemValue,
      codigo_ncm: '87163900',
      icms_origem: 0,
      icms_situacao_tributaria: '00',
      icms_modalidade_base_calculo: '3',
      icms_base_calculo: itemValue,
      icms_aliquota: icmsAliq,
      icms_valor: icmsVal,
      ipi_situacao_tributaria: '51',
      ipi_base_calculo: itemValue,
      ipi_aliquota: 0,
      ipi_valor: 0,
      pis_situacao_tributaria: '01',
      pis_base_calculo: itemValue,
      pis_aliquota: pisAliq,
      pis_valor: pisVal,
      cofins_situacao_tributaria: '01',
      cofins_base_calculo: itemValue,
      cofins_aliquota: cofinsAliq,
      cofins_valor: cofinsVal,
      // DIFAL — ICMSUFDest (EC 87/2015)
      icms_base_calculo_uf_destino: itemValue,
      icms_aliquota_interna_uf_destino: difalAliqInt,
      icms_aliquota_interestadual: icmsAliq,
      icms_valor_uf_destino: difalVal,
      icms_valor_uf_remetente: 0,
      icms_percentual_fcp: 0,
      // Grupo veículo novo
      veiculos_novos: {
        tipo_operacao: '1',
        chassi: '9BGRD08X0XG000001',
        codigo_cor: '09',
        descricao_cor: 'PRATA',
        potencia_motor: '0',
        cm3: '0',
        peso_liquido: '1.200',
        peso_bruto: '6.000',
        serie: 'SN-TESTE-001',
        tipo_combustivel: '99',
        numero_motor: '000000000000000000000',
        cmt: '7.200',
        ano_modelo: 2026,
        ano_fabricacao: 2026,
        tipo_pintura: 'S',
        tipo: '10',
        especie: '2',
        vin: 'N',
        condicao: '1',
        codigo_marca_modelo: '999999',
        codigo_cor_denatran: '09',
        lotacao: '0',
        restricao: '0',
      },
    },
  ],
  formas_pagamento: [
    {
      forma_pagamento: '99',
      valor: itemValue,
    },
  ],
};

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  TESTE E2E — Emissão NF-e Focus NFe (Homologação)          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`📌 Ref: ${ref}`);
  console.log(`📌 Base URL: ${FOCUS_BASE_URL}`);
  console.log(`📌 Emitente: GDR INDUSTRIA DE REBOQUES LTDA (46.247.069/0001-15)`);
  console.log(`📌 Destinatário: EMPRESA TESTE LTDA (SC — interestadual)`);
  console.log(`📌 Item: Reboque NCM 87163900 — R$ ${itemValue.toFixed(2)}`);
  console.log(`📌 ICMS: ${icmsAliq}% = R$ ${icmsVal.toFixed(2)}`);
  console.log(`📌 IPI: 0% (CST 51)`);
  console.log(`📌 PIS: ${pisAliq}% = R$ ${pisVal.toFixed(2)} (CST 01)`);
  console.log(`📌 COFINS: ${cofinsAliq}% = R$ ${cofinsVal.toFixed(2)} (CST 01)`);
  console.log(`📌 DIFAL: ${difalAliqInt}% - ${icmsAliq}% = R$ ${difalVal.toFixed(2)}`);
  console.log(`📌 Veículo: chassi 9BGRD08X0XG000001 (tipo 10=Reboque)`);
  console.log();

  console.log('── Payload enviado para Focus ──');
  console.log(JSON.stringify(payload, null, 2));
  console.log();

  const url = `${FOCUS_BASE_URL}/v2/nfe?ref=${ref}`;
  const authHeader = 'Basic ' + Buffer.from(`${FOCUS_TOKEN}:`).toString('base64');

  console.log(`🚀 POST ${url}`);
  console.log();

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
      return;
    }

    if (data.status === 'processando_autorizacao') {
      console.log('⏳ NF-e em PROCESSAMENTO — fazendo polling...');
      console.log();

      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const statusUrl = `${FOCUS_BASE_URL}/v2/nfe/${ref}`;
        const statusRes = await fetch(statusUrl, {
          headers: { Authorization: authHeader },
        });
        const sd = await statusRes.json();
        const icon = sd.status === 'autorizado' ? '✅' : sd.status === 'rejeitado' ? '❌' : '⏳';
        console.log(`[${(i + 1) * 5}s] ${icon} Status: ${sd.status}`);

        if (sd.status === 'autorizado') {
          console.log(`   Chave: ${sd.chave_nfe}`);
          console.log();
          console.log('✅ NF-e AUTORIZADA COM SUCESSO!');
          return;
        }
        if (sd.status === 'rejeitado') {
          console.log(`   Código: ${sd.codigo ?? sd.status_sefaz}`);
          console.log(`   Motivo: ${sd.motivo ?? sd.mensagem_sefaz}`);
          console.log();
          console.log('❌ NF-e REJEITADA');
          return;
        }
        if (sd.status === 'erro') {
          console.log(`   Erro: ${sd.motivo}`);
          return;
        }
      }
      console.log('⚠️  Timeout no polling — verificar manualmente');
      return;
    }

    // Erros e rejeições
    const code = data.codigo || data.status_sefaz || '';
    const reason = data.motivo || data.mensagem_sefaz || data.mensagem || '';
    if (data.status === 'rejeitado' || data.erros) {
      console.log(`❌ NF-e REJEITADA`);
      if (data.erros) {
        for (const err of data.erros) {
          console.log(`   → ${err.codigo}: ${err.mensagem}`);
        }
      } else {
        console.log(`   [${code}] ${reason}`);
      }
    } else if (data.status === 'erro') {
      console.log(`❌ ERRO: [${code}] ${reason}`);
    } else {
      console.log(`⚠️  Status inesperado: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.error(`❌ Erro de conexão: ${err.message}`);
  }
}

main().catch(console.error);
