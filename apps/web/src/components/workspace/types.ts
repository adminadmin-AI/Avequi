import type { ComponentType } from 'react';

/**
 * Tipos do sistema de widgets do Workspace (Home por papel) — F0.
 *
 * A Home deixa de ser um dashboard hardcoded e vira uma composição de
 * widgets: um REGISTRY descreve o que existe (widget-meta.ts + registry),
 * TEMPLATES por perfil descrevem a experiência default de cada papel
 * (templates.ts) e, nas fases seguintes, overrides por usuário persistem
 * desvios do template (F2).
 */

export type WidgetId =
  | 'greeting'
  | 'kpi-summary'
  | 'ai-insights'
  | 'pending-tasks'
  | 'alerts'
  | 'shortcuts'
  | 'agenda'
  | 'cashflow-13w'
  | 'crm-sla'
  | 'wms-queue'
  | 'capacity-bottlenecks'
  | 'chart-revenue'
  | 'chart-production';

/** Presets de tamanho — sem resize livre por pixel, de propósito. */
export type WidgetSize = 'half' | 'full';

/**
 * Zonas com ordem narrativa FIXA: orientação → atenção → trabalho → contexto.
 * Gráfico nunca sobe acima de tarefa — isso é invariante do sistema, não
 * preferência do usuário (a personalização da F2 só reordena DENTRO de zona).
 */
export type WidgetZone = 'orientation' | 'attention' | 'work' | 'context';

export const ZONE_ORDER: readonly WidgetZone[] = [
  'orientation',
  'attention',
  'work',
  'context',
] as const;

/** Uma ocorrência de widget dentro de um template (ou, na F2, de um layout salvo). */
export interface WidgetInstance {
  id: WidgetId;
  size?: WidgetSize;
  /** Configuração por template (ex.: quais métricas o KPI mostra, quais atalhos). */
  props?: Record<string, unknown>;
}

export interface WidgetComponentProps {
  instance: WidgetInstance;
}

/** Metadados puros de um widget (sem React) — testáveis em node. */
export interface WidgetMeta {
  id: WidgetId;
  title: string;
  /**
   * Elegibilidade RBAC v2, semântica anyOf. Lista vazia = qualquer autenticado.
   * REGRA DE OURO (igual ao catálogo do IAM): o code aqui é o do endpoint que
   * o widget consome — widget não inventa permissão própria.
   * Isto é UX (fail-closed enquanto carrega); o enforcement real é o
   * PermissionGuard no backend.
   */
  permission: string[];
  zone: WidgetZone;
  defaultSize: WidgetSize;
  /** Presets permitidos no modo edição (F2). 1 item = tamanho fixo. */
  sizes: WidgetSize[];
}

/** Desvio persistido do template (F2) — shape espelhado no LayoutWidgetDto da API. */
export interface LayoutOverride {
  id: WidgetId;
  size?: WidgetSize;
  hidden?: boolean;
  pinned?: boolean;
}

export interface PersistedLayout {
  profile?: string | null;
  version: number;
  widgets: LayoutOverride[];
}

export interface WidgetDefinition extends WidgetMeta {
  Component: ComponentType<WidgetComponentProps>;
}
