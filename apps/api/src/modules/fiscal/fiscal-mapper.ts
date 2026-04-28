/**
 * Mapeador de payload para a API Focus NFe.
 *
 * Regras de CFOP utilizadas (PRD GDR):
 *   5102 — Venda de mercadoria adquirida ou recebida de terceiros — operação dentro do estado
 *   6102 — Venda de mercadoria adquirida ou recebida de terceiros — operação interestadual
 *
 * A escolha de NF-e vs NFC-e segue o tipo do documento solicitado.
 * Esta função é pura (sem efeitos colaterais) para facilitar testes unitários.
 */

export interface FiscalItem {
  sku: string;
  name: string;
  ncm: string;
  quantity: number;
  unitPrice: number;
  unit: string;
}

export interface FiscalEmitter {
  cnpj: string;
  name: string;
  address: string;
  city: string;
  state: string;
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

/** Payload NFC-e (cupom fiscal eletrônico — consumidor final) */
export function buildNFCePayload(input: FiscalPayloadInput): Record<string, unknown> {
  return {
    natureza_operacao: 'VENDA A CONSUMIDOR',
    forma_pagamento: 0,
    emitente: {
      cnpj: input.emitter.cnpj.replace(/\D/g, ''),
      nome: input.emitter.name,
      logradouro: input.emitter.address,
      municipio: input.emitter.city,
      uf: input.emitter.state,
    },
    ...(input.recipient?.document && {
      destinatario: {
        nome: input.recipient.name,
        cpf_cnpj: input.recipient.document.replace(/\D/g, ''),
      },
    }),
    items: input.items.map((item, idx) => ({
      numero_item: idx + 1,
      codigo_produto: item.sku,
      descricao: item.name,
      cfop: '5102',
      unidade_comercial: item.unit,
      quantidade_comercial: item.quantity,
      valor_unitario_comercial: item.unitPrice,
      valor_total_bruto: Number((item.quantity * item.unitPrice).toFixed(2)),
      codigo_ncm: (item.ncm ?? '00000000').replace(/\D/g, '').padStart(8, '0'),
      icms_origem: 0,
      icms_situacao_tributaria: '102',
    })),
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
  const cfop = isInterstate ? '6102' : '5102';

  return {
    natureza_operacao: 'VENDA DE PRODUTO',
    forma_pagamento: 0,
    emitente: {
      cnpj: input.emitter.cnpj.replace(/\D/g, ''),
      nome: input.emitter.name,
      logradouro: input.emitter.address,
      municipio: input.emitter.city,
      uf: input.emitter.state,
    },
    destinatario: {
      nome: input.recipient?.name ?? 'CONSUMIDOR NÃO IDENTIFICADO',
      ...(input.recipient?.document && {
        cpf_cnpj: input.recipient.document.replace(/\D/g, ''),
      }),
      ...(input.recipient?.state && { uf: input.recipient.state }),
    },
    items: input.items.map((item, idx) => ({
      numero_item: idx + 1,
      codigo_produto: item.sku,
      descricao: item.name,
      cfop,
      unidade_comercial: item.unit,
      quantidade_comercial: item.quantity,
      valor_unitario_comercial: item.unitPrice,
      valor_total_bruto: Number((item.quantity * item.unitPrice).toFixed(2)),
      codigo_ncm: (item.ncm ?? '00000000').replace(/\D/g, '').padStart(8, '0'),
      icms_origem: 0,
      icms_situacao_tributaria: '102',
    })),
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
