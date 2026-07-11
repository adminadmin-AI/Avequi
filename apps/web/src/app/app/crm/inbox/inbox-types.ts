/** Tipos do inbox WhatsApp (CRM F1.3 #509) — espelham as respostas de /crm/* */

export interface StageRef {
  id: string;
  name: string;
  color: string | null;
  type: 'OPEN' | 'WON' | 'LOST';
  order?: number;
}

export interface ConversationSummary {
  id: string;
  leadId: string;
  unreadCount: number;
  lastMessageAt: string | null;
  windowExpiresAt: string | null;
  windowOpen: boolean;
  lead: {
    id: string;
    name: string | null;
    phone: string | null;
    source: string;
    interest: string | null;
    /** F4 (#524): ACTIVE/QUALIFIED = IA atendendo agora */
    sdrStatus: 'ACTIVE' | 'QUALIFIED' | 'HANDOFF' | 'DISCARDED' | null;
    stage: StageRef | null;
    assignedTo: { id: string; name: string } | null;
  };
  lastMessage: {
    direction: 'IN' | 'OUT';
    type: string;
    preview: string;
    status: string;
    createdAt: string;
  } | null;
}

export interface WaMessage {
  id: string;
  direction: 'IN' | 'OUT';
  type: 'TEXT' | 'AUDIO' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'STICKER' | 'LOCATION' | 'CONTACTS' | 'UNSUPPORTED';
  text: string | null;
  waMediaId: string | null;
  mediaMimeType: string | null;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  createdAt: string;
}

export interface LeadActivity {
  id: string;
  type: string;
  happensAt: string;
  actorId: string | null;
  properties: Record<string, unknown> | null;
}

export interface LeadDetail {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  sdrStatus?: 'ACTIVE' | 'QUALIFIED' | 'HANDOFF' | 'DISCARDED' | null;
  interest: string | null;
  estimatedValue: string | null;
  lostReason: string | null;
  /** Categoria estruturada da perda (#570); null = não categorizado */
  lostReasonCategory: string | null;
  createdAt: string;
  stage: StageRef | null;
  assignedTo: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  activities: LeadActivity[];
  /** #574 — nomes das lojas onde o mesmo telefone está em negociação */
  crossStoreStores?: string[];
}

/** Lembrete de follow-up (F3.5-C5 #555) */
export interface Reminder {
  id: string;
  leadId: string;
  text: string;
  dueAt: string;
  doneAt: string | null;
  user?: { id: string; name: string };
  lead?: { id: string; name: string | null; phone: string | null };
}

/** Resposta rápida (F3.5-C3 #553): owner null = compartilhada da loja */
export interface QuickReply {
  id: string;
  shortcut: string;
  text: string;
  ownerId: string | null;
  owner: { id: string; name: string } | null;
}

/** Resolve as variáveis da resposta rápida ({nome} = primeiro nome do lead) */
export function renderQuickReply(text: string, leadName: string | null | undefined): string {
  const firstName = leadName?.trim().split(/\s+/)[0] ?? '';
  return text.replaceAll('{nome}', firstName);
}

export const SOURCE_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  META_ADS: 'Meta Ads',
  OLX: 'OLX',
  MERCADO_LIVRE: 'Mercado Livre',
  SITE: 'Site',
  TELEFONE: 'Telefone',
};

export const ACTIVITY_LABEL: Record<string, string> = {
  MESSAGE_IN: 'Mensagem recebida',
  MESSAGE_OUT: 'Mensagem enviada',
  STAGE_CHANGE: 'Mudança de estágio',
  ASSIGNMENT: 'Atribuição',
  NOTE: 'Nota',
  CALL: 'Ligação',
  CONVERSION: 'Conversão',
};

/** "23h" / "45min" restantes na janela; null = expirada/inexistente */
export function windowRemaining(windowExpiresAt: string | null): string | null {
  if (!windowExpiresAt) return null;
  const ms = new Date(windowExpiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600_000);
  if (h >= 1) return `${h}h`;
  return `${Math.max(1, Math.floor(ms / 60_000))}min`;
}
