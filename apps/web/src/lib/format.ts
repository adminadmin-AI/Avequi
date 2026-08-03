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

/**
 * Tempo relativo curto em pt-BR por extenso ("agora", "há 5 min", "há 2 h",
 * "há 3 dias") — a partir de 30 dias cai para a data absoluta (formatDate).
 * Ver também `relativeTime`/`timeAgo` locais (notification-bell, crm/inbox)
 * — versões abreviadas para contextos mais compactos; esta é a forma por
 * extenso usada em tabelas/detalhe (ex.: painel Ops #910).
 */
export function formatRelativeTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
  return formatDate(d);
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


/**
 * Exibição de razão social vinda em CAIXA ALTA (dados migrados do Omie):
 * Title Case pragmático — conectivos ficam minúsculos, siglas curtas sem
 * vogal (FLX, ZL) e sufixos societários usuais preservam a forma esperada.
 * NÃO altera o dado — é só apresentação.
 */
const NAME_LOWER = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para']);
const NAME_UPPER = new Set(['me', 'sa', 's/a', 'epp', 'eireli', 'cnpj']);
export function prettyName(raw: string): string {
  if (!raw) return raw;
  // se não está (quase) todo em caixa alta, respeita como veio
  const letters = raw.replace(/[^a-zA-ZÀ-ÿ]/g, '');
  if (!letters || letters !== letters.toUpperCase()) return raw;
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      const bare = w.replace(/[.,()]/g, '');
      if (NAME_UPPER.has(bare)) return w.toUpperCase();
      // sigla curta sem vogal (zl, flx, j.) mantém caixa alta
      if (bare.length <= 3 && !/[aeiouáéíóúà]/.test(bare)) return w.toUpperCase();
      if (i > 0 && NAME_LOWER.has(bare)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}
