/** Tipos do funil/kanban (CRM F2.1 #514) */
import { SOURCE_LABEL } from '../inbox/inbox-types';

export { SOURCE_LABEL };

export interface BoardStage {
  id: string;
  name: string;
  color: string | null;
  type: 'OPEN' | 'WON' | 'LOST';
  order: number;
}

export interface BoardLead {
  id: string;
  name: string | null;
  phone: string | null;
  source: string;
  interest: string | null;
  estimatedValue: string | null;
  position: string;
  assignedTo: { id: string; name: string } | null;
  lastInteractionAt: string | null;
  unreadCount: number;
  windowOpen: boolean;
}

export interface BoardColumn {
  stage: BoardStage;
  leads: BoardLead[];
  count: number;
  totalValue: number;
}

export interface Board {
  columns: BoardColumn[];
  unstaged: BoardLead[];
}

export function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
