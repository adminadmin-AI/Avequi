import type { BadgeVariant } from '@/components/ui/badge';
import type { ProposalStatus } from '@/types/api';

/**
 * Regras puras das propostas comerciais — AVECCHI P2 (#963).
 * Fora do componente porque são o que o teste consegue provar (o runner do
 * apps/web roda em `node`, sem DOM — mesmo padrão de `panel-format.ts`).
 *
 * A fonte da verdade continua sendo o backend (`ProposalsService.getOpen`):
 * aqui só espelhamos as regras para não oferecer um botão que a API recusa.
 */

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviada',
  ACCEPTED: 'Aceita',
  DECLINED: 'Recusada',
  EXPIRED: 'Vencida',
};

export const PROPOSAL_STATUS_VARIANT: Record<ProposalStatus, BadgeVariant> = {
  DRAFT: 'neutral',
  SENT: 'info',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  EXPIRED: 'warning',
};

/**
 * Valor NEGOCIADO = difere do preço de tabela do plano.
 * Plano sem preço de tabela não gera badge: sem tabela não existe desvio a
 * alegar (regra da casa — número inventado não existe).
 */
export function ehNegociado(p: {
  priceCents: number;
  plan?: { priceCents: number | null } | null;
}): boolean {
  const tabela = p.plan?.priceCents;
  return tabela != null && tabela !== p.priceCents;
}

/** Passou da validade? Sem `validUntil` a proposta não vence. */
export function estaVencida(p: { validUntil: string | null }, agora: Date = new Date()): boolean {
  if (!p.validUntil) return false;
  const limite = new Date(p.validUntil).getTime();
  return Number.isFinite(limite) && limite < agora.getTime();
}

/**
 * Status EXIBIDO: o backend só grava EXPIRED quando alguém toca na proposta,
 * então uma DRAFT/SENT fora da validade continua com o status antigo na
 * listagem. A tela mostra o estado real — não o carimbo desatualizado.
 */
export function statusExibido(
  p: { status: ProposalStatus; validUntil: string | null },
  agora: Date = new Date(),
): ProposalStatus {
  const aberta = p.status === 'DRAFT' || p.status === 'SENT';
  return aberta && estaVencida(p, agora) ? 'EXPIRED' : p.status;
}

/** Decidida = imutável (upgrade/downgrade é proposta NOVA). */
export function ehDecidida(p: { status: ProposalStatus }): boolean {
  return p.status === 'ACCEPTED' || p.status === 'DECLINED';
}

/**
 * Ações oferecidas na linha. `accept`/`decline` valem para DRAFT e SENT — é o
 * que `getOpen()` aceita no backend (proposta pode ser fechada na mesa, sem
 * passar por "enviada").
 */
export function acoesDaProposta(
  p: { status: ProposalStatus; validUntil: string | null },
  agora: Date = new Date(),
): { podeEnviar: boolean; podeDecidir: boolean } {
  const s = statusExibido(p, agora);
  return { podeEnviar: s === 'DRAFT', podeDecidir: s === 'DRAFT' || s === 'SENT' };
}

/**
 * Validade digitada no `<input type="date">` → ISO no FIM do dia LOCAL.
 * Sem isso, "válida até 10/08" viraria 10/08 00:00 UTC = 09/08 21:00 em
 * Brasília, e a proposta venceria um dia antes do combinado.
 */
export function validadeParaISO(dateInput: string): string | undefined {
  if (!dateInput) return undefined;
  const d = new Date(`${dateInput}T23:59:59`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
