/**
 * Mapeador de payload para a API Focus NFe.
 *
 * CFOPs padrão (GDR = indústria — produção própria):
 *   5101 — Venda de produção própria — operação dentro do estado
 *   6101 — Venda de produção própria — operação interestadual
 *   5152 — Transferência de produção própria — operação dentro do estado
 *   6152 — Transferência de produção própria — operação interestadual
 *
 * O CFOP real vem de TaxRule via item.tax.cfop. Os defaults acima são fallbacks.
 * Esta função é pura (sem efeitos colaterais) para facilitar testes unitários.
 */

export interface FiscalDifal {
  baseCalculo: number;
  aliquotaInterna: number;
  aliquotaInterestadual: number;
  valor: number;
}

/** CSTs de IPI tributado (grupo IPITrib) — os demais (01-05, 51-55) geram IPINT */
const IPI_TRIBUTED_CSTS = ['00', '49', '50', '99'];

/**
 * Data de emissão no fuso de Brasília (-03:00, sem DST desde 2019).
 * UTC puro faz a nota "pular" para o dia seguinte após as 21h locais —
 * SEFAZ então rejeita cancelamento/CC-e do mesmo dia com cód 577
 * ("data do evento menor que a data de emissão").
 */
function nowBrasilia(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, '-03:00');
}

export interface FiscalItemTax {
  cfop: string;
  icmsCst: string;
  icmsBase: number;
  icmsAliquota: number;
  icmsValor: number;
  ipiCst: string;
  ipiBase: number;
  ipiAliquota: number;
  ipiValor: number;
  pisCst: string;
  pisBase: number;
  pisAliquota: number;
  pisValor: number;
  cofinsCst: string;
  cofinsBase: number;
  cofinsAliquota: number;
  cofinsValor: number;
  difal?: FiscalDifal;
  // IBS/CBS — grupo UB, NT 2025.002-RTC (#415)
  ibsCbs?: FiscalIbsCbs;
}

export interface FiscalIbsCbs {
  cClassTrib: string;
  cbsCst: string;
  base: number;         // vBC comum a CBS/IBS (valor da operação)
  cbsAliquota: number;
  cbsValor: number;
  ibsUfAliquota: number;
  ibsUfValor: number;
  ibsMunAliquota: number;
  ibsMunValor: number;
}

export interface FiscalItem {
  sku: string;
  name: string;
  ncm: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  tax?: FiscalItemTax;
  vehicle?: FiscalVehicleData;
}

export interface FiscalEmitter {
  cnpj: string;
  name: string;
  ie?: string;
  crt?: number;
  address: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city: string;
  state: string;
  zipCode?: string;
  ibgeCode?: string;
  phone?: string;
}

export interface FiscalRecipient {
  name: string;
  document?: string; // CPF ou CNPJ
  ie?: string; // inscrição estadual
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  ibgeCode?: string;
}

export interface FiscalVehicleData {
  tipoOperacao: string;  // 1=Venda concessionária
  chassi: string;        // VIN 17 chars
  codigoCor: string;
  descricaoCor: string;
  potenciaMotor: number; // 0 p/ reboque
  cilindrada: number;    // 0 p/ reboque
  pesoLiquido: string;   // toneladas (decimal string)
  pesoBruto: string;     // PBT toneladas
  serie: string;
  tipoCombustivel: string; // 99=sem motor
  numeroMotor: string;
  cmt?: string;
  distanciaEixos?: number;
  anoModelo: number;
  anoFabricacao: number;
  tipoPintura: string;   // S=Sólida, M=Metálica, P=Perolizada
  tipoVeiculo: string;   // 10=Reboque
  especieVeiculo: string; // 2=Carga
  vin: string;           // N=Normal, R=Remarcado
  condicao: string;      // 1=Acabado
  codigoMarcaModelo: string; // 6 dígitos RENAVAM
  corDenatran: string;
  lotacao: number;       // 0 p/ reboque
  restricao: string;     // 0=Sem restrição
}

export interface FiscalPayloadInput {
  ref: string; // referência única gerada pelo GDR (ex: "GDR-SO-<id>")
  emitter: FiscalEmitter;
  recipient?: FiscalRecipient;
  items: FiscalItem[];
  totalValue: number;
  paymentMethod?: string; // '01' dinheiro, '03' cartão crédito, '04' cartão débito, '99' outros
  consumidorFinal?: boolean; // true = indicador_consumidor_final: 1 na NF-e
  infCpl?: string; // informações complementares (#370)
}

/**
 * Grupo veicProd (JA) — campos flat com prefixo veiculo_ dentro do item,
 * conforme dicionário oficial (campos.focusnfe.com.br/nfe/ItemNotaFiscalXML.html).
 * Objeto aninhado `veiculos_novos` é IGNORADO silenciosamente pela Focus.
 */
function mapVehicleToPayload(v: FiscalVehicleData) {
  return {
    veiculo_tipo_operacao: v.tipoOperacao,
    veiculo_chassi: v.chassi,
    veiculo_codigo_cor: v.codigoCor,
    veiculo_descricao_cor: v.descricaoCor,
    veiculo_potencia_motor: String(v.potenciaMotor),
    veiculo_cm3: String(v.cilindrada),
    veiculo_peso_liquido: v.pesoLiquido,
    veiculo_peso_bruto: v.pesoBruto,
    veiculo_serie: v.serie.slice(0, 9), // nSerie: máx 9 chars no XSD
    veiculo_tipo_combustivel: v.tipoCombustivel,
    veiculo_numero_motor: v.numeroMotor,
    veiculo_cmt: v.cmt ?? '0', // CMT e dist são obrigatórios no veicProd
    veiculo_distancia_eixos: String(v.distanciaEixos ?? 0),
    veiculo_ano_modelo: v.anoModelo,
    veiculo_ano_fabricacao: v.anoFabricacao,
    veiculo_tipo_pintura: v.tipoPintura,
    veiculo_tipo: v.tipoVeiculo,
    veiculo_especie: v.especieVeiculo,
    veiculo_codigo_vin: v.vin,
    veiculo_condicao: v.condicao,
    veiculo_codigo_marca_modelo: v.codigoMarcaModelo,
    veiculo_codigo_cor_denatran: v.corDenatran,
    veiculo_lotacao: String(v.lotacao),
    veiculo_restricao: v.restricao,
  };
}

function mapItemToPayload(item: FiscalItem, idx: number, defaultCfop: string) {
  const t = item.tax;
  return {
    numero_item: idx + 1,
    codigo_produto: item.sku,
    descricao: item.name,
    cfop: t?.cfop ?? defaultCfop,
    unidade_comercial: item.unit,
    quantidade_comercial: item.quantity,
    valor_unitario_comercial: item.unitPrice,
    valor_total_bruto: Number((item.quantity * item.unitPrice).toFixed(2)),
    codigo_ncm: (item.ncm ?? '00000000').replace(/\D/g, '').padStart(8, '0'),
    icms_origem: 0,
    icms_situacao_tributaria: t?.icmsCst ?? '00',
    icms_modalidade_base_calculo: '3', // 3=Valor da operação
    ...(t && {
      icms_base_calculo: t.icmsBase,
      icms_aliquota: t.icmsAliquota,
      icms_valor: t.icmsValor,
      ipi_situacao_tributaria: t.ipiCst,
      ipi_codigo_enquadramento_legal: '999', // cEnq obrigatório no grupo IPI
      // CSTs 01-05/51-55 geram grupo IPINT (não tributado), que rejeita base/alíquota/valor
      ...(IPI_TRIBUTED_CSTS.includes(t.ipiCst) && {
        ipi_base_calculo: t.ipiBase,
        ipi_aliquota: t.ipiAliquota,
        ipi_valor: t.ipiValor,
      }),
      pis_situacao_tributaria: t.pisCst,
      pis_base_calculo: t.pisBase,
      pis_aliquota: t.pisAliquota,
      pis_valor: t.pisValor,
      cofins_situacao_tributaria: t.cofinsCst,
      cofins_base_calculo: t.cofinsBase,
      cofins_aliquota: t.cofinsAliquota,
      cofins_valor: t.cofinsValor,
    }),
    // IBS/CBS — grupo UB da NT 2025.002-RTC, campos flat da API Focus (#415)
    // Totais (grupo W03) são calculados automaticamente pela Focus a partir dos itens
    ...(t?.ibsCbs && {
      ibs_cbs_situacao_tributaria: t.ibsCbs.cbsCst,
      ibs_cbs_classificacao_tributaria: t.ibsCbs.cClassTrib,
      ibs_cbs_base_calculo: t.ibsCbs.base,
      cbs_aliquota: t.ibsCbs.cbsAliquota,
      cbs_valor: t.ibsCbs.cbsValor,
      ibs_uf_aliquota: t.ibsCbs.ibsUfAliquota,
      ibs_uf_valor: t.ibsCbs.ibsUfValor,
      ibs_mun_aliquota: t.ibsCbs.ibsMunAliquota,
      ibs_mun_valor: t.ibsCbs.ibsMunValor,
    }),
    ...(item.vehicle && mapVehicleToPayload(item.vehicle)),
    // DIFAL — campos Focus NFe para ICMSUFDest (EC 87/2015)
    ...(t?.difal && {
      icms_base_calculo_uf_destino: t.difal.baseCalculo,
      icms_aliquota_interna_uf_destino: t.difal.aliquotaInterna,
      icms_aliquota_interestadual: t.difal.aliquotaInterestadual,
      icms_valor_uf_destino: t.difal.valor,
      icms_valor_uf_remetente: 0, // 100% destino desde 2019 (EC 87/2015)
      icms_percentual_fcp: 0, // FCP não aplicável para reboques no PR
    }),
  };
}

/**
 * Campos flat do emitente conforme API v2 Focus NFe.
 * IMPORTANTE: a Focus NÃO aceita objeto aninhado `emitente: {}` — sem o
 * `cnpj_emitente` na raiz ela responde 403 "CNPJ do emitente não autorizado".
 */
function mapEmitterFlat(e: FiscalEmitter): Record<string, unknown> {
  return {
    cnpj_emitente: e.cnpj.replace(/\D/g, ''),
    nome_emitente: e.name,
    ...(e.ie && { inscricao_estadual_emitente: e.ie }),
    logradouro_emitente: e.address,
    ...(e.number && { numero_emitente: e.number }),
    ...(e.complement && { complemento_emitente: e.complement }),
    ...(e.neighborhood && { bairro_emitente: e.neighborhood }),
    municipio_emitente: e.city,
    uf_emitente: e.state,
    ...(e.zipCode && { cep_emitente: e.zipCode.replace(/\D/g, '') }),
    ...(e.phone && { telefone_emitente: e.phone.replace(/\D/g, '') }),
    ...(e.crt && { regime_tributario_emitente: e.crt }),
  };
}

/** Campos flat do destinatário conforme API v2 Focus NFe (cpf vs cnpj pelo tamanho) */
function mapRecipientFlat(
  r: FiscalRecipient | undefined,
  consumidorFinal?: boolean,
): Record<string, unknown> {
  const doc = r?.document?.replace(/\D/g, '') ?? '';
  // "ISENTO"/vazio no cadastro = destinatário sem IE (evita rejeição SEFAZ 728)
  const ie = r?.ie && /^\d+$/.test(r.ie.replace(/[.\-\/]/g, '')) ? r.ie.replace(/\D/g, '') : undefined;
  return {
    nome_destinatario: r?.name ?? 'CONSUMIDOR NÃO IDENTIFICADO',
    ...(doc && (doc.length === 11 ? { cpf_destinatario: doc } : { cnpj_destinatario: doc })),
    ...(ie
      ? { inscricao_estadual_destinatario: ie, indicador_inscricao_estadual_destinatario: '1' }
      : { indicador_inscricao_estadual_destinatario: consumidorFinal ? '9' : '2' }),
    ...(r?.address && { logradouro_destinatario: r.address }),
    ...(r?.number && { numero_destinatario: r.number }),
    ...(r?.complement && { complemento_destinatario: r.complement }),
    ...(r?.neighborhood && { bairro_destinatario: r.neighborhood }),
    ...(r?.city && { municipio_destinatario: r.city }),
    ...(r?.state && { uf_destinatario: r.state }),
    ...(r?.zipCode && { cep_destinatario: r.zipCode.replace(/\D/g, '') }),
  };
}

/** Payload NFC-e (cupom fiscal eletrônico — consumidor final) */
export function buildNFCePayload(input: FiscalPayloadInput): Record<string, unknown> {
  const doc = input.recipient?.document?.replace(/\D/g, '') ?? '';
  return {
    natureza_operacao: 'VENDA A CONSUMIDOR',
    data_emissao: nowBrasilia(),
    tipo_documento: '1',
    finalidade_emissao: '1',
    consumidor_final: '1',
    presenca_comprador: '1',
    modalidade_frete: '9',
    ...mapEmitterFlat(input.emitter),
    ...(doc && {
      nome_destinatario: input.recipient!.name,
      ...(doc.length === 11 ? { cpf_destinatario: doc } : { cnpj_destinatario: doc }),
    }),
    items: input.items.map((item, idx) => mapItemToPayload(item, idx, '5101')),
    formas_pagamento: [
      {
        forma_pagamento: input.paymentMethod ?? '99',
        valor: input.totalValue,
      },
    ],
  };
}

/** Payload NF-e (nota fiscal eletrônica — saída para pessoa jurídica ou interestadual) */
export function buildNFePayload(input: FiscalPayloadInput): Record<string, unknown> {
  const isInterstate = input.recipient?.state && input.emitter.state !== input.recipient.state;
  const cfop = isInterstate ? '6101' : '5101';

  return {
    natureza_operacao: 'VENDA DE PRODUÇÃO PRÓPRIA',
    data_emissao: nowBrasilia(),
    tipo_documento: '1',
    finalidade_emissao: '1',
    consumidor_final: input.consumidorFinal ? '1' : '0',
    presenca_comprador: '1', // 1=Presencial (venda em loja)
    modalidade_frete: '9', // 9=Sem frete (default — ajustar quando houver transporte)
    ...(input.infCpl && { informacoes_adicionais_contribuinte: input.infCpl }),
    ...mapEmitterFlat(input.emitter),
    ...mapRecipientFlat(input.recipient, input.consumidorFinal),
    items: input.items.map((item, idx) => mapItemToPayload(item, idx, cfop)),
    // forma 90 (sem pagamento) — obrigatória em devolução/entrada (rejeição SEFAZ 871) — exige valor 0
    formas_pagamento: [
      {
        forma_pagamento: input.paymentMethod ?? '99',
        valor: input.paymentMethod === '90' ? 0 : input.totalValue,
      },
    ],
  };
}

/** Calcula o valor total da nota a partir dos itens */
export function calcTotalValue(items: FiscalItem[]): number {
  return Number(
    items.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0).toFixed(2),
  );
}

/** Payload NF-e de transferência entre estabelecimentos (CFOP 5152/6152) */
export function buildTransferNFePayload(input: FiscalPayloadInput): Record<string, unknown> {
  const isInterstate = input.recipient?.state && input.emitter.state !== input.recipient.state;
  const cfop = isInterstate ? '6152' : '5152';

  const doc = input.recipient?.document?.replace(/\D/g, '') ?? '';
  return {
    natureza_operacao: 'TRANSFERÊNCIA DE MERCADORIA',
    data_emissao: nowBrasilia(),
    tipo_documento: '1',
    finalidade_emissao: '1',
    consumidor_final: '0',
    presenca_comprador: '9',
    modalidade_frete: '9',
    ...mapEmitterFlat(input.emitter),
    nome_destinatario: input.recipient?.name ?? 'ESTABELECIMENTO DESTINATÁRIO',
    ...(doc && (doc.length === 11 ? { cpf_destinatario: doc } : { cnpj_destinatario: doc })),
    ...(input.recipient?.ie && { inscricao_estadual_destinatario: input.recipient.ie, indicador_inscricao_estadual_destinatario: '1' }),
    ...(input.recipient?.address && { logradouro_destinatario: input.recipient.address }),
    ...(input.recipient?.number && { numero_destinatario: input.recipient.number }),
    ...(input.recipient?.neighborhood && { bairro_destinatario: input.recipient.neighborhood }),
    ...(input.recipient?.city && { municipio_destinatario: input.recipient.city }),
    ...(input.recipient?.state && { uf_destinatario: input.recipient.state }),
    ...(input.recipient?.zipCode && { cep_destinatario: input.recipient.zipCode.replace(/\D/g, '') }),
    items: input.items.map((item, idx) => mapItemToPayload(item, idx, cfop)),
    formas_pagamento: [{ forma_pagamento: '99', valor: input.totalValue }],
  };
}
