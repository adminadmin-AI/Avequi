/**
 * Formatadores brasileiros — padrão do brandbook Avequi v2.0.
 * Sempre exibir dados com máscara; nunca crus.
 */

const onlyDigits = (v: string | number): string => String(v ?? '').replace(/\D/g, '');

// ─── Moeda (R$ 1.234,56) ──────────────────────────────────────────────────────
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n == null || Number.isNaN(n)) return brl.format(0);
  return brl.format(n);
}

const numberFmt = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

export function formatNumber(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n == null || Number.isNaN(n)) return '0';
  return numberFmt.format(n);
}

export function formatPercent(value: number | string | null | undefined, digits = 2): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n == null || Number.isNaN(n)) return '0%';
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

// ─── Documentos (CNPJ / CPF) ──────────────────────────────────────────────────
export function formatCNPJ(value: string | null | undefined): string {
  const d = onlyDigits(value ?? '').padStart(14, '0').slice(0, 14);
  if (!value) return '';
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function formatCPF(value: string | null | undefined): string {
  const d = onlyDigits(value ?? '').padStart(11, '0').slice(0, 11);
  if (!value) return '';
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

/** Aceita CPF (11) ou CNPJ (14) e aplica a máscara correta. */
export function formatCpfCnpj(value: string | null | undefined): string {
  const d = onlyDigits(value ?? '');
  if (!value) return '';
  return d.length > 11 ? formatCNPJ(d) : formatCPF(d);
}

// ─── Fiscal ───────────────────────────────────────────────────────────────────
/** Chave NF-e: 44 dígitos em grupos de 4. */
export function formatChaveNFe(value: string | null | undefined): string {
  const d = onlyDigits(value ?? '');
  if (!d) return '';
  return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

/** CFOP: 5.102 */
export function formatCFOP(value: string | number | null | undefined): string {
  const d = onlyDigits(value ?? '');
  if (d.length !== 4) return String(value ?? '');
  return `${d[0]}.${d.slice(1)}`;
}

/** NCM: 8471.30.12 */
export function formatNCM(value: string | null | undefined): string {
  const d = onlyDigits(value ?? '');
  if (d.length !== 8) return String(value ?? '');
  return d.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
}

// ─── Contato ──────────────────────────────────────────────────────────────────
export function formatPhone(value: string | null | undefined): string {
  const d = onlyDigits(value ?? '');
  if (!d) return '';
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return value ?? '';
}

export function formatCEP(value: string | null | undefined): string {
  const d = onlyDigits(value ?? '');
  if (d.length !== 8) return value ?? '';
  return d.replace(/^(\d{5})(\d{3})$/, '$1-$2');
}

// ─── Datas (DD/MM/AAAA) ───────────────────────────────────────────────────────
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Para inputs <input type="date"> → YYYY-MM-DD */
export function toDateInput(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

// ─── Parsers (string mascarada → valor cru) ───────────────────────────────────
export const unmask = onlyDigits;

/** "R$ 1.234,56" ou "1.234,56" → 1234.56 */
export function parseBRL(value: string): number {
  const normalized = value
    .replace(/[^\d,-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(normalized);
  return Number.isNaN(n) ? 0 : n;
}
