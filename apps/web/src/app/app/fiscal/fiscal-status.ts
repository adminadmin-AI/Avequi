import type { FiscalStatus, FiscalDocumentType, FiscalFinalidade } from '@/types/api';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export const FISCAL_STATUS: Record<FiscalStatus, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: 'Pendente', variant: 'neutral' },
  PROCESSING: { label: 'Processando', variant: 'info' },
  AUTHORIZED: { label: 'Autorizada', variant: 'success' },
  REJECTED: { label: 'Rejeitada', variant: 'danger' },
  CANCELLED: { label: 'Cancelada', variant: 'neutral' },
  ERROR: { label: 'Erro', variant: 'danger' },
};

export const FISCAL_STATUS_OPTIONS = Object.entries(FISCAL_STATUS).map(([value, meta]) => ({
  value: value as FiscalStatus,
  label: meta.label,
}));

export const FISCAL_TYPE_LABEL: Record<FiscalDocumentType, string> = {
  NFE: 'NF-e',
  NFCE: 'NFC-e',
};

// #758 — finalidade da nota (Reforma Tributária). NORMAL é a operação padrão
// (sem badge na UI — ver callers); as demais ganham badge para destacar que a
// nota não é uma venda comum.
export const FISCAL_FINALIDADE_LABEL: Record<FiscalFinalidade, { label: string; variant: BadgeVariant }> = {
  NORMAL: { label: 'Normal', variant: 'neutral' },
  COMPLEMENTAR: { label: 'Complementar', variant: 'neutral' },
  AJUSTE: { label: 'Ajuste', variant: 'neutral' },
  DEVOLUCAO: { label: 'Devolução', variant: 'warning' },
  NOTA_CREDITO: { label: 'Nota de Crédito', variant: 'success' },
  NOTA_DEBITO: { label: 'Nota de Débito', variant: 'danger' },
};

// Opções do filtro da listagem — só finalidades que hoje têm fluxo no app.
export const FISCAL_FINALIDADE_FILTER_OPTIONS: { value: FiscalFinalidade; label: string }[] = [
  { value: 'NORMAL', label: FISCAL_FINALIDADE_LABEL.NORMAL.label },
  { value: 'DEVOLUCAO', label: FISCAL_FINALIDADE_LABEL.DEVOLUCAO.label },
  { value: 'NOTA_DEBITO', label: FISCAL_FINALIDADE_LABEL.NOTA_DEBITO.label },
  { value: 'NOTA_CREDITO', label: FISCAL_FINALIDADE_LABEL.NOTA_CREDITO.label },
];

// #757/#758 — catálogos de motivo (tpNFDebito/tpNFCredito, SINIEF 49/2025)
export const TIPO_NOTA_DEBITO_LABEL: Record<string, string> = {
  '01': 'Transferência de créditos para Cooperativas',
  '02': 'Anulação de crédito por saídas imunes/isentas',
  '03': 'Débitos de NF não processadas na apuração',
  '04': 'Multa e juros',
  '05': 'Transferência de crédito na sucessão',
  '06': 'Pagamento antecipado',
  '07': 'Perda em estoque',
  '08': 'Desenquadramento do Simples Nacional',
};

export const TIPO_NOTA_CREDITO_LABEL: Record<string, string> = {
  '01': 'Multa e juros',
  '02': 'Crédito presumido ZFM',
  '03': 'Retorno por recusa na entrega',
  '04': 'Redução de valores',
  '05': 'Transferência de crédito na sucessão',
  '06': 'Retorno por recusa parcial na entrega',
};

export const TIPO_NOTA_DEBITO_OPTIONS = Object.entries(TIPO_NOTA_DEBITO_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export const TIPO_NOTA_CREDITO_OPTIONS = Object.entries(TIPO_NOTA_CREDITO_LABEL).map(([value, label]) => ({
  value,
  label,
}));
