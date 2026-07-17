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
  fcpAliquota?: number; // % FCP do UF destino (#445)
  fcpValor?: number;
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
  // gRed (#446, NT 2025.002 UB26/UB45/UB64) — CSTs 2xx: sem eles a SEFAZ rejeita 1033
  cbsPRedAliq?: number;
  cbsAliqEfet?: number;
  ibsUfPRedAliq?: number;
  ibsUfAliqEfet?: number;
  ibsMunPRedAliq?: number;
  ibsMunAliqEfet?: number;
}

export interface FiscalItem {
  sku: string;
  name: string;
  ncm: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  origem?: string; // origem da mercadoria 0-8 → orig no XML (#480)
  ean?: string; // GTIN → cEAN/cEANTrib; ausente = Focus emite SEM GTIN (#484)
  cest?: string; // código CEST quando sujeito a ST (#484)
  unidadeTributavel?: string; // uTrib quando ≠ unidade comercial (#484)
  fatorConversaoTributavel?: number; // qTrib = qCom × fator (#484)
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

/** Indicador de IE do destinatário (indIEDest) — espelho do enum IcmsIndicator do Prisma (#474) */
export type FiscalIcmsIndicator = 'CONTRIBUINTE' | 'ISENTO' | 'NAO_CONTRIBUINTE';

export interface FiscalRecipient {
  name: string;
  razaoSocial?: string; // PJ: DANFE usa a razão social quando presente (#474)
  document?: string; // CPF ou CNPJ
  ie?: string; // inscrição estadual
  indIeDest?: FiscalIcmsIndicator; // explícito do cadastro; ausente = inferir (#474)
  email?: string; // e-mail fiscal do destinatário (xml <email>)
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  ibgeCode?: string;
}

/** Endereço de entrega ≠ fiscal — grupo <entrega> da NF-e (#474) */
export interface FiscalDeliveryAddress {
  name?: string; // nome do recebedor no local
  document?: string; // CPF/CNPJ do recebedor (obrigatório no grupo entrega)
  address: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city: string;
  state: string;
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
  qtdEixos?: number | null; // só p/ descrição no infCpl (veicProd não tem campo)
  lotacao: number;       // 0 p/ reboque
  restricao: string;     // 0=Sem restrição
}

/** Grupo transp da NF-e — transportador, veículo e volumes (#481) */
export interface FiscalFreight {
  modality: string; // modFrete: 0-CIF 1-FOB 2-terceiros 3-próprio remetente 4-próprio destinatário 9-sem frete
  value?: number; // vFrete
  carrier?: {
    document?: string; // CNPJ/CPF
    name?: string; // razão social (xNome)
    ie?: string;
    address?: string; // xEnder (logradouro + número em campo único)
    city?: string;
    state?: string;
  };
  vehiclePlate?: string;
  vehiclePlateState?: string;
  rntc?: string;
  volumes?: Array<{
    quantidade: number;
    especie?: string;
    marca?: string;
    numeracao?: string;
    pesoLiquido?: number; // kg
    pesoBruto?: number; // kg
  }>;
}

/**
 * #587 — uma forma do detPag (lista). Cartão TEF integrado (tpIntegra=1)
 * exige o grupo card: CNPJ da credenciadora + bandeira + autorização, que
 * vêm do gate TEF (#596) gravados no SalesPayment.
 */
export interface FiscalPaymentForm {
  tPag: string; // código tabela 4.3.4.1 ('01' dinheiro, '03' crédito, '04' débito, '17' PIX…)
  amount: number;
  card?: {
    cnpjCredenciadora?: string; // CNPJ da adquirente (Acquirer.cnpj)
    tBand: string; // código da bandeira ('01' Visa … '99' outros)
    cAut: string; // autorização do TEF (authCode; fallback NSU)
  };
}

/** Bandeira (SalesPayment.brand) → tBand da NF-e (tabela cartões) */
export const CARD_BRAND_CODES: Record<string, string> = {
  VISA: '01',
  MASTERCARD: '02',
  AMEX: '03',
  'AMERICAN EXPRESS': '03',
  SOROCRED: '04',
  DINERS: '05',
  ELO: '06',
  HIPERCARD: '07',
  AURA: '08',
  CABAL: '09',
};

export const cardBrandCode = (brand?: string | null): string =>
  (brand && CARD_BRAND_CODES[brand.toUpperCase()]) || '99';

export interface FiscalPayloadInput {
  ref: string; // referência única gerada pelo GDR (ex: "GDR-SO-<id>")
  emitter: FiscalEmitter;
  recipient?: FiscalRecipient;
  items: FiscalItem[];
  totalValue: number;
  paymentMethod?: string; // '01' dinheiro, '03' cartão crédito, '04' cartão débito, '99' outros
  payments?: FiscalPaymentForm[]; // #587 — plano multi-forma; quando presente, vence o paymentMethod
  consumidorFinal?: boolean; // true = indicador_consumidor_final: 1 na NF-e
  infCpl?: string; // informações complementares (#370)
  delivery?: FiscalDeliveryAddress; // grupo <entrega> quando ≠ endereço fiscal (#474)
  freight?: FiscalFreight; // grupo transp — ausente = modalidade 9 (#481)
  // #747/#754 — emissão referenciada (devolução hoje; débito/crédito no épico #753)
  finalidade?: '1' | '2' | '3' | '4' | '5' | '6'; // finNFe — ausente = '1'
  naturezaOperacao?: string; // sobrescreve a natureza padrão do builder
  tipoDocumento?: '0' | '1'; // tpNF — 0=entrada (devolução), ausente = '1'
  referencedKeys?: string[]; // chaves das NF-e referenciadas (notas_referenciadas)
}

/**
 * #587 — formas_pagamento da Focus (detPag como LISTA). Nomes flat oficiais
 * do dicionário (FormaPagamentoXML): tipo_integracao (tpIntegra),
 * cnpj_credenciadora, bandeira_operadora (tBand), numero_autorizacao (cAut).
 * Lição do projeto: campo flat com nome errado a Focus IGNORA em silêncio —
 * validado em homologação (XML autorizado com grupo card conferido).
 */
export function mapPaymentsFlat(input: FiscalPayloadInput): Array<Record<string, unknown>> {
  const totalWithFreight = Number((input.totalValue + (input.freight?.value ?? 0)).toFixed(2));

  if (input.payments?.length) {
    return input.payments.map((p) => ({
      forma_pagamento: p.tPag,
      valor_pagamento: Number(p.amount.toFixed(2)),
      ...(p.card && {
        tipo_integracao: '1', // TEF/gateway INTEGRADO — decisão do épico (#583)
        ...(p.card.cnpjCredenciadora && { cnpj_credenciadora: p.card.cnpjCredenciadora }),
        bandeira_operadora: p.card.tBand,
        numero_autorizacao: p.card.cAut,
      }),
    }));
  }

  // legado: forma única (retrocompat #479); '90' (sem pagamento) exige valor 0
  return [
    {
      forma_pagamento: input.paymentMethod ?? '99',
      valor_pagamento: input.paymentMethod === '90' ? 0 : totalWithFreight,
    },
  ];
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

/**
 * Rateia o frete total pelos itens proporcionalmente ao valor (2 casas),
 * jogando o resíduo de arredondamento no último item. A SEFAZ valida
 * vFrete do total = Σ vFrete dos itens (rejeição 535) — o frete é
 * SEMPRE informado por item, nunca só no cabeçalho (#481).
 */
function allocateFreight(items: FiscalItem[], value?: number): number[] | undefined {
  if (!value || value <= 0) return undefined;
  const totals = items.map((i) => i.quantity * i.unitPrice);
  const grand = totals.reduce((s, v) => s + v, 0);
  if (grand <= 0) return undefined;
  let allocated = 0;
  return totals.map((t, i) => {
    if (i === totals.length - 1) return Number((value - allocated).toFixed(2));
    const share = Number(((value * t) / grand).toFixed(2));
    allocated = Number((allocated + share).toFixed(2));
    return share;
  });
}

/**
 * xProd do item veicular sai "DESCRIÇÃO - CHASSI XXXXXXXXXXXXXXXXX" — exigência
 * do quadro na validação do DANFE (14/07). xProd aceita 120 chars no XSD: a
 * descrição é clampada para o chassi nunca ser cortado.
 */
export function buildItemDescription(item: FiscalItem): string {
  const chassi = item.vehicle?.chassi;
  if (!chassi) return item.name;
  const suffix = ` - CHASSI ${chassi}`;
  return item.name.slice(0, 120 - suffix.length) + suffix;
}

function mapItemToPayload(item: FiscalItem, idx: number, defaultCfop: string, freightShare?: number) {
  const t = item.tax;
  return {
    numero_item: idx + 1,
    // vFrete rateado do item — o vFrete do ICMSTot é o somatório (#481)
    ...(freightShare != null && freightShare > 0 && { valor_frete: freightShare }),
    codigo_produto: item.sku,
    descricao: buildItemDescription(item),
    cfop: t?.cfop ?? defaultCfop,
    unidade_comercial: item.unit,
    quantidade_comercial: item.quantity,
    valor_unitario_comercial: item.unitPrice,
    valor_total_bruto: Number((item.quantity * item.unitPrice).toFixed(2)),
    codigo_ncm: (item.ncm ?? '00000000').replace(/\D/g, '').padStart(8, '0'),
    icms_origem: Number(item.origem ?? '0'), // orig do produto — 1/2/3/8 = importado (#480)
    // GTIN (cEAN/cEANTrib): omitir quando não cadastrado — a Focus emite "SEM GTIN" (#484)
    ...(item.ean && {
      codigo_barras_comercial: item.ean.replace(/\D/g, ''),
      codigo_barras_tributavel: item.ean.replace(/\D/g, ''),
    }),
    ...(item.cest && { cest: item.cest.replace(/\D/g, '') }),
    // Unidade tributável quando ≠ comercial: qTrib = qCom × fator, vUnTrib = vUnCom ÷ fator (#484)
    ...(item.unidadeTributavel && {
      unidade_tributavel: item.unidadeTributavel,
      quantidade_tributavel: Number((item.quantity * (item.fatorConversaoTributavel ?? 1)).toFixed(4)),
      valor_unitario_tributavel: Number((item.unitPrice / (item.fatorConversaoTributavel ?? 1)).toFixed(10)),
    }),
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
      // gRed (#446) — nomes oficiais do dicionário Focus (campos.focusnfe.com.br);
      // CST 2xx sem esses campos = rejeição 1033
      ...(t.ibsCbs.cbsPRedAliq != null && {
        cbs_percentual_reducao_aliquota: t.ibsCbs.cbsPRedAliq,
        cbs_aliquota_efetiva: t.ibsCbs.cbsAliqEfet,
      }),
      ...(t.ibsCbs.ibsUfPRedAliq != null && {
        ibs_uf_percentual_reducao_aliquota: t.ibsCbs.ibsUfPRedAliq,
        ibs_uf_aliquota_efetiva: t.ibsCbs.ibsUfAliqEfet,
      }),
      ...(t.ibsCbs.ibsMunPRedAliq != null && {
        ibs_mun_percentual_reducao_aliquota: t.ibsCbs.ibsMunPRedAliq,
        ibs_mun_aliquota_efetiva: t.ibsCbs.ibsMunAliqEfet,
      }),
    }),
    ...(item.vehicle && mapVehicleToPayload(item.vehicle)),
    // DIFAL — campos Focus NFe para ICMSUFDest (EC 87/2015)
    ...(t?.difal && {
      icms_base_calculo_uf_destino: t.difal.baseCalculo,
      icms_aliquota_interna_uf_destino: t.difal.aliquotaInterna,
      icms_aliquota_interestadual: t.difal.aliquotaInterestadual,
      icms_valor_uf_destino: t.difal.valor,
      icms_valor_uf_remetente: 0, // 100% destino desde 2019 (EC 87/2015)
      // FCP do UF destino (#445) — nomes oficiais do dicionário Focus
      // (o antigo `icms_percentual_fcp` não existe na API e era ignorado)
      ...(t.difal.fcpValor && t.difal.fcpValor > 0
        ? {
            fcp_base_calculo_uf_destino: t.difal.baseCalculo,
            fcp_percentual_uf_destino: t.difal.fcpAliquota,
            fcp_valor_uf_destino: t.difal.fcpValor,
          }
        : {
            fcp_percentual_uf_destino: 0,
            fcp_valor_uf_destino: 0,
          }),
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
  // indIEDest explícito do cadastro (#474); ausente → inferência legada por IE/consumidorFinal
  const indicador = r?.indIeDest
    ? { CONTRIBUINTE: '1', ISENTO: '2', NAO_CONTRIBUINTE: '9' }[r.indIeDest]
    : ie ? '1' : consumidorFinal ? '9' : '2';
  return {
    nome_destinatario: r?.razaoSocial ?? r?.name ?? 'CONSUMIDOR NÃO IDENTIFICADO',
    ...(doc && (doc.length === 11 ? { cpf_destinatario: doc } : { cnpj_destinatario: doc })),
    indicador_inscricao_estadual_destinatario: indicador,
    ...(ie && indicador === '1' && { inscricao_estadual_destinatario: ie }),
    ...(r?.email && { email_destinatario: r.email }),
    ...(r?.address && { logradouro_destinatario: r.address }),
    ...(r?.number && { numero_destinatario: r.number }),
    ...(r?.complement && { complemento_destinatario: r.complement }),
    ...(r?.neighborhood && { bairro_destinatario: r.neighborhood }),
    ...(r?.city && { municipio_destinatario: r.city }),
    ...(r?.state && { uf_destinatario: r.state }),
    ...(r?.zipCode && { cep_destinatario: r.zipCode.replace(/\D/g, '') }),
  };
}

/**
 * Grupo transp da NF-e — campos flat do transportador + volumes[] (#481).
 * Sem freight → modalidade 9 (sem frete), comportamento anterior preservado.
 * Nomes conforme dicionário Focus (NotaFiscalXML): cnpj/cpf_transportador,
 * nome_transportador, inscricao_estadual_transportador, endereco/municipio/
 * uf_transportador, volumes[{quantidade, especie, marca, numeracao,
 * peso_liquido, peso_bruto}], valor_frete.
 * Placa: veiculo_placa/veiculo_uf/veiculo_rntc — validar na auditoria de
 * homologação (nomes não constam do trecho público do dicionário).
 */
function mapFreightFlat(f?: FiscalFreight): Record<string, unknown> {
  if (!f) return { modalidade_frete: '9' };
  const doc = f.carrier?.document?.replace(/\D/g, '') ?? '';
  return {
    modalidade_frete: f.modality,
    // valor do frete NÃO vai no cabeçalho: é rateado por item (rej. 535) e a
    // Focus totaliza o vFrete do ICMSTot a partir dos itens
    ...(f.carrier && {
      ...(doc && (doc.length === 11 ? { cpf_transportador: doc } : { cnpj_transportador: doc })),
      ...(f.carrier.name && { nome_transportador: f.carrier.name }),
      ...(f.carrier.ie && { inscricao_estadual_transportador: f.carrier.ie.replace(/\D/g, '') }),
      ...(f.carrier.address && { endereco_transportador: f.carrier.address }),
      ...(f.carrier.city && { municipio_transportador: f.carrier.city }),
      ...(f.carrier.state && { uf_transportador: f.carrier.state }),
    }),
    ...(f.vehiclePlate && {
      veiculo_placa: f.vehiclePlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
      ...(f.vehiclePlateState && { veiculo_uf: f.vehiclePlateState }),
      ...(f.rntc && { veiculo_rntc: f.rntc }),
    }),
    ...(f.volumes?.length && {
      volumes: f.volumes.map((v) => ({
        quantidade: v.quantidade,
        ...(v.especie && { especie: v.especie }),
        ...(v.marca && { marca: v.marca }),
        ...(v.numeracao && { numeracao: v.numeracao }),
        ...(v.pesoLiquido != null && { peso_liquido: Number(v.pesoLiquido.toFixed(3)) }),
        ...(v.pesoBruto != null && { peso_bruto: Number(v.pesoBruto.toFixed(3)) }),
      })),
    }),
  };
}

/** Grupo <entrega> da NF-e — campos flat *_entrega (#474). CPF/CNPJ do recebedor é obrigatório no grupo. */
function mapDeliveryFlat(d: FiscalDeliveryAddress, r?: FiscalRecipient): Record<string, unknown> {
  const doc = (d.document ?? r?.document ?? '').replace(/\D/g, '');
  if (!doc) return {}; // sem documento o grupo é inválido — omite e a nota sai sem <entrega>
  return {
    ...(doc.length === 11 ? { cpf_entrega: doc } : { cnpj_entrega: doc }),
    ...(d.name && { nome_entrega: d.name }),
    logradouro_entrega: d.address,
    ...(d.number && { numero_entrega: d.number }),
    ...(d.complement && { complemento_entrega: d.complement }),
    ...(d.neighborhood && { bairro_entrega: d.neighborhood }),
    municipio_entrega: d.city,
    uf_entrega: d.state,
    ...(d.zipCode && { cep_entrega: d.zipCode.replace(/\D/g, '') }),
  };
}

/** Payload NFC-e (cupom fiscal eletrônico — consumidor final) */
/**
 * Assinatura do sistema nas Informações Complementares (DANFE) — pedido do
 * Claudio (13/07/2026). Impressa em TODA nota (NF-e, NFC-e, transferência),
 * de qualquer empresa emissora — é a marca do produto no documento.
 * "www." proposital: em papel, leigo reconhece como endereço de site.
 */
const ERP_SIGNATURE = 'Documento emitido pelo ERP Avecchi - www.avecchi.ai';
function withBranding(infCpl?: string): string {
  return infCpl ? `${infCpl} | ${ERP_SIGNATURE}` : ERP_SIGNATURE;
}

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
    // #587: detPag como lista (multi-forma + grupo card); nome oficial Focus
    // é valor_pagamento — `valor` era ignorado e o vPag saía 0
    formas_pagamento: mapPaymentsFlat(input),
    informacoes_adicionais_contribuinte: withBranding(input.infCpl),
  };
}

/** Payload NF-e (nota fiscal eletrônica — saída para pessoa jurídica ou interestadual) */
export function buildNFePayload(input: FiscalPayloadInput): Record<string, unknown> {
  const isInterstate = input.recipient?.state && input.emitter.state !== input.recipient.state;
  const isReturn = input.finalidade === '4';
  // Devolução de venda é nota de ENTRADA: CFOP 1202/2202 (fallback — a TaxRule
  // DEVOLUCAO_VENDA do item prevalece via item.tax.cfop, como na venda)
  const cfop = isReturn ? (isInterstate ? '2202' : '1202') : isInterstate ? '6101' : '5101';
  const freightShares = allocateFreight(input.items, input.freight?.value);

  return {
    natureza_operacao: input.naturezaOperacao ?? 'VENDA DE PRODUÇÃO PRÓPRIA',
    data_emissao: nowBrasilia(),
    // dhSaiEnt preenchido (pedido Claudio 13/07): saída imediata = emissão (balcão/retira)
    data_entrada_saida: nowBrasilia(),
    tipo_documento: input.tipoDocumento ?? '1',
    finalidade_emissao: input.finalidade ?? '1',
    // NF-e referenciada (obrigatória em devolução/débito/crédito — #747/#753)
    ...(input.referencedKeys?.length && {
      notas_referenciadas: input.referencedKeys.map((chave_nfe) => ({ chave_nfe })),
    }),
    consumidor_final: input.consumidorFinal ? '1' : '0',
    presenca_comprador: '1', // 1=Presencial (venda em loja)
    ...mapFreightFlat(input.freight), // grupo transp — sem freight = modalidade 9 (#481)
    informacoes_adicionais_contribuinte: withBranding(input.infCpl),
    ...mapEmitterFlat(input.emitter),
    ...mapRecipientFlat(input.recipient, input.consumidorFinal),
    // Grupo <entrega> — endereço de entrega ≠ fiscal (#474), campos flat oficiais
    ...(input.delivery && mapDeliveryFlat(input.delivery, input.recipient)),
    items: input.items.map((item, idx) => mapItemToPayload(item, idx, cfop, freightShares?.[idx])),
    // forma 90 (sem pagamento) — obrigatória em devolução/entrada (rejeição SEFAZ 871) — exige valor 0.
    // vFrete compõe o vNF — o detPag precisa somar o frete ou a SEFAZ rejeita
    // pagamento ≠ total da nota (#481)
    // #587: detPag como lista (multi-forma + grupo card tpIntegra=1)
    formas_pagamento: mapPaymentsFlat(input),
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
    informacoes_adicionais_contribuinte: withBranding(input.infCpl),
    data_emissao: nowBrasilia(),
    // dhSaiEnt preenchido (pedido Claudio 13/07): saída imediata = emissão (balcão/retira)
    data_entrada_saida: nowBrasilia(),
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
    formas_pagamento: [{ forma_pagamento: '99', valor_pagamento: input.totalValue }],
  };
}

// ─── #756: Nota de Débito/Crédito da Reforma (finNFe 5/6, SINIEF 49/2025) ─────

export interface FiscalAdjustmentPayloadItem {
  sku: string;
  name: string;
  ncm: string | null;
  base: number;
  cClassTrib: string;
  cstCbs: string;
  cbsAliquota: number;
  cbsValor: number;
  ibsUfAliquota: number;
  ibsUfValor: number;
  ibsMunAliquota: number;
  ibsMunValor: number;
}

export interface AdjustmentPayloadInput {
  ref: string;
  finalidade: '5' | '6'; // 5 = Nota de Crédito, 6 = Nota de Débito
  tipoNota: string; // tpNFCredito 01-06 / tpNFDebito 01-08
  referencedKey: string; // chave da NF-e original (obrigatória)
  emitter: FiscalEmitter;
  recipient?: FiscalRecipient;
  items: FiscalAdjustmentPayloadItem[];
  infCpl?: string;
  naturezaOperacao?: string;
  /** tpNF — default '1' (saída). A definir em homologação p/ crédito (F4 #760). */
  tipoDocumento?: '0' | '1';
  /** CFOP dos itens — default 5949/6949 (outra saída) conforme UF; confirmar na F4. */
  cfop?: string;
}

// Payload flat Focus para nota de débito/crédito IBS/CBS. Regra da Reforma:
// notas finNFe 5/6 SÓ podem conter IBS/CBS — nenhum campo de icms/ipi/pis/
// cofins nos itens (a SEFAZ rejeita tributo estranho). Campos tipo_nota_debito
// e tipo_nota_credito conforme dicionário Focus (campos.focusnfe.com.br);
// nomes flat errados são ignorados EM SILÊNCIO — validação real na F4 (#760).
export function buildAdjustmentNFePayload(input: AdjustmentPayloadInput): Record<string, unknown> {
  const natureza =
    input.naturezaOperacao ??
    (input.finalidade === '6' ? 'NOTA DE DEBITO IBS/CBS' : 'NOTA DE CREDITO IBS/CBS');

  const isInterstate = input.recipient?.state && input.emitter.state !== input.recipient.state;
  const cfop = input.cfop ?? (isInterstate ? '6949' : '5949');

  return {
    natureza_operacao: natureza,
    data_emissao: nowBrasilia(),
    tipo_documento: input.tipoDocumento ?? '1',
    finalidade_emissao: input.finalidade,
    ...(input.finalidade === '6'
      ? { tipo_nota_debito: input.tipoNota }
      : { tipo_nota_credito: input.tipoNota }),
    notas_referenciadas: [{ chave_nfe: input.referencedKey }],
    consumidor_final: '0',
    presenca_comprador: '9', // não presencial — ajuste documental
    modalidade_frete: '9',
    ...mapEmitterFlat(input.emitter),
    ...mapRecipientFlat(input.recipient, false),
    items: input.items.map((it, idx) => ({
      numero_item: idx + 1,
      codigo_produto: it.sku,
      descricao: it.name,
      cfop,
      codigo_ncm: (it.ncm ?? '00000000').replace(/\D/g, '').padStart(8, '0'),
      unidade_comercial: 'UN',
      quantidade_comercial: 1,
      valor_unitario_comercial: it.base,
      valor_total_bruto: it.base,
      // SOMENTE grupo IBS/CBS (grupo UB) — nada de ICMS/IPI/PIS/COFINS
      ibs_cbs_situacao_tributaria: it.cstCbs,
      ibs_cbs_classificacao_tributaria: it.cClassTrib,
      ibs_cbs_base_calculo: it.base,
      cbs_aliquota: it.cbsAliquota,
      cbs_valor: it.cbsValor,
      ibs_uf_aliquota: it.ibsUfAliquota,
      ibs_uf_valor: it.ibsUfValor,
      ibs_mun_aliquota: it.ibsMunAliquota,
      ibs_mun_valor: it.ibsMunValor,
    })),
    // ajuste documental: sem operação comercial — mesmo padrão da devolução
    formas_pagamento: [{ forma_pagamento: '90', valor_pagamento: 0 }],
    informacoes_adicionais_contribuinte: withBranding(input.infCpl),
  };
}
