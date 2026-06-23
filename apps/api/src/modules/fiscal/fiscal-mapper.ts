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
}

export interface FiscalItem {
  sku: string;
  name: string;
  ncm: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  tax?: FiscalItemTax;
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
  state?: string;
}

export interface FiscalPayloadInput {
  ref: string; // referência única gerada pelo GDR (ex: "GDR-SO-<id>")
  emitter: FiscalEmitter;
  recipient?: FiscalRecipient;
  items: FiscalItem[];
  totalValue: number;
  paymentMethod?: string; // '01' dinheiro, '03' cartão crédito, '04' cartão débito, '99' outros
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
    ...(t && {
      icms_base_calculo: t.icmsBase,
      icms_aliquota: t.icmsAliquota,
      icms_valor: t.icmsValor,
      ipi_situacao_tributaria: t.ipiCst,
      ipi_base_calculo: t.ipiBase,
      ipi_aliquota: t.ipiAliquota,
      ipi_valor: t.ipiValor,
      pis_situacao_tributaria: t.pisCst,
      pis_base_calculo: t.pisBase,
      pis_aliquota: t.pisAliquota,
      pis_valor: t.pisValor,
      cofins_situacao_tributaria: t.cofinsCst,
      cofins_base_calculo: t.cofinsBase,
      cofins_aliquota: t.cofinsAliquota,
      cofins_valor: t.cofinsValor,
    }),
  };
}

/** Payload NFC-e (cupom fiscal eletrônico — consumidor final) */
export function buildNFCePayload(input: FiscalPayloadInput): Record<string, unknown> {
  return {
    natureza_operacao: 'VENDA A CONSUMIDOR',
    forma_pagamento: 0,
    emitente: {
      cnpj: input.emitter.cnpj.replace(/\D/g, ''),
      nome: input.emitter.name,
      ...(input.emitter.ie && { inscricao_estadual: input.emitter.ie }),
      logradouro: input.emitter.address,
      ...(input.emitter.number && { numero: input.emitter.number }),
      ...(input.emitter.complement && { complemento: input.emitter.complement }),
      ...(input.emitter.neighborhood && { bairro: input.emitter.neighborhood }),
      municipio: input.emitter.city,
      uf: input.emitter.state,
      ...(input.emitter.zipCode && { cep: input.emitter.zipCode.replace(/\D/g, '') }),
      ...(input.emitter.ibgeCode && { codigo_municipio: input.emitter.ibgeCode }),
      ...(input.emitter.phone && { telefone: input.emitter.phone.replace(/\D/g, '') }),
      ...(input.emitter.crt && { regime_tributario: input.emitter.crt }),
    },
    ...(input.recipient?.document && {
      destinatario: {
        nome: input.recipient.name,
        cpf_cnpj: input.recipient.document.replace(/\D/g, ''),
      },
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
    forma_pagamento: 0,
    emitente: {
      cnpj: input.emitter.cnpj.replace(/\D/g, ''),
      nome: input.emitter.name,
      ...(input.emitter.ie && { inscricao_estadual: input.emitter.ie }),
      logradouro: input.emitter.address,
      ...(input.emitter.number && { numero: input.emitter.number }),
      ...(input.emitter.complement && { complemento: input.emitter.complement }),
      ...(input.emitter.neighborhood && { bairro: input.emitter.neighborhood }),
      municipio: input.emitter.city,
      uf: input.emitter.state,
      ...(input.emitter.zipCode && { cep: input.emitter.zipCode.replace(/\D/g, '') }),
      ...(input.emitter.ibgeCode && { codigo_municipio: input.emitter.ibgeCode }),
      ...(input.emitter.phone && { telefone: input.emitter.phone.replace(/\D/g, '') }),
      ...(input.emitter.crt && { regime_tributario: input.emitter.crt }),
    },
    destinatario: {
      nome: input.recipient?.name ?? 'CONSUMIDOR NÃO IDENTIFICADO',
      ...(input.recipient?.document && {
        cpf_cnpj: input.recipient.document.replace(/\D/g, ''),
      }),
      ...(input.recipient?.state && { uf: input.recipient.state }),
    },
    items: input.items.map((item, idx) => mapItemToPayload(item, idx, cfop)),
    formas_pagamento: [
      {
        forma_pagamento: input.paymentMethod ?? '99',
        valor: input.totalValue,
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

  return {
    natureza_operacao: 'TRANSFERÊNCIA DE MERCADORIA',
    forma_pagamento: 0,
    emitente: {
      cnpj: input.emitter.cnpj.replace(/\D/g, ''),
      nome: input.emitter.name,
      ...(input.emitter.ie && { inscricao_estadual: input.emitter.ie }),
      logradouro: input.emitter.address,
      ...(input.emitter.number && { numero: input.emitter.number }),
      ...(input.emitter.complement && { complemento: input.emitter.complement }),
      ...(input.emitter.neighborhood && { bairro: input.emitter.neighborhood }),
      municipio: input.emitter.city,
      uf: input.emitter.state,
      ...(input.emitter.zipCode && { cep: input.emitter.zipCode.replace(/\D/g, '') }),
      ...(input.emitter.ibgeCode && { codigo_municipio: input.emitter.ibgeCode }),
      ...(input.emitter.phone && { telefone: input.emitter.phone.replace(/\D/g, '') }),
      ...(input.emitter.crt && { regime_tributario: input.emitter.crt }),
    },
    destinatario: {
      nome: input.recipient?.name ?? 'ESTABELECIMENTO DESTINATÁRIO',
      ...(input.recipient?.document && {
        cpf_cnpj: input.recipient.document.replace(/\D/g, ''),
      }),
      ...(input.recipient?.state && { uf: input.recipient.state }),
    },
    items: input.items.map((item, idx) => mapItemToPayload(item, idx, cfop)),
    formas_pagamento: [{ forma_pagamento: '99', valor: input.totalValue }],
  };
}
