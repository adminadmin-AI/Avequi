import { describe, expect, it } from 'vitest';
import { resolveProfile, TEMPLATES, type WorkspaceProfile } from './templates';
import { ALL_WIDGET_IDS, WIDGET_META } from './widget-meta';
import { ZONE_ORDER } from './types';

/**
 * Invariantes do Workspace (F0):
 * - todo template referencia widgets que existem no registry;
 * - a ordem narrativa por zona (orientação → atenção → trabalho → contexto)
 *   é respeitada em TODOS os templates — gráfico nunca sobe acima de tarefa;
 * - resolveProfile cobre v2, fallback legado e default.
 */

const PROFILES = Object.keys(TEMPLATES) as WorkspaceProfile[];

describe('TEMPLATES', () => {
  it('todo widget de template existe no registry', () => {
    for (const p of PROFILES) {
      for (const w of TEMPLATES[p].widgets) {
        expect(ALL_WIDGET_IDS, `template ${p} referencia widget desconhecido: ${w.id}`).toContain(
          w.id,
        );
      }
    }
  });

  it('nenhum template repete widget', () => {
    for (const p of PROFILES) {
      const ids = TEMPLATES[p].widgets.map((w) => w.id);
      expect(new Set(ids).size, `template ${p} tem widget duplicado`).toBe(ids.length);
    }
  });

  it('ordem de zona é não-decrescente em todos os templates (gráfico nunca antes de tarefa)', () => {
    for (const p of PROFILES) {
      const zones = TEMPLATES[p].widgets.map((w) => ZONE_ORDER.indexOf(WIDGET_META[w.id].zone));
      for (let i = 1; i < zones.length; i++) {
        expect(
          zones[i],
          `template ${p}: widget ${TEMPLATES[p].widgets[i].id} está antes da zona do anterior`,
        ).toBeGreaterThanOrEqual(zones[i - 1]);
      }
    }
  });

  it('todo template começa com a saudação e inclui alertas', () => {
    for (const p of PROFILES) {
      expect(TEMPLATES[p].widgets[0]?.id, `template ${p}`).toBe('greeting');
      expect(
        TEMPLATES[p].widgets.some((w) => w.id === 'alerts'),
        `template ${p} sem alerts`,
      ).toBe(true);
    }
  });

  it('template de produção nunca inclui métricas financeiras', () => {
    const kpi = TEMPLATES.production.widgets.find((w) => w.id === 'kpi-summary');
    const metrics = (kpi?.props?.metrics as string[]) ?? [];
    for (const forbidden of ['revenue', 'cash', 'overdue-receivable', 'payable-upcoming']) {
      expect(metrics).not.toContain(forbidden);
    }
    expect(TEMPLATES.production.widgets.some((w) => w.id === 'chart-revenue')).toBe(false);
  });
});

describe('WIDGET_META', () => {
  it('permission codes seguem o formato modulo.recurso.acao do catálogo IAM', () => {
    const CODE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
    for (const id of ALL_WIDGET_IDS) {
      for (const code of WIDGET_META[id].permission) {
        expect(code, `widget ${id}`).toMatch(CODE);
      }
    }
  });

  it('id do meta bate com a chave do registro', () => {
    for (const id of ALL_WIDGET_IDS) {
      expect(WIDGET_META[id].id).toBe(id);
    }
  });
});

describe('resolveProfile', () => {
  it('prioriza perfil RBAC v2 sobre enum legado', () => {
    expect(resolveProfile(['SUPERVISOR_PRODUCAO'], 'FINANCIAL')).toBe('production');
  });

  it('com múltiplos perfis v2, vence o de maior precedência', () => {
    expect(resolveProfile(['FINANCEIRO', 'DIRETOR'], undefined)).toBe('executive');
    expect(resolveProfile(['VENDEDOR', 'GERENTE_FINANCEIRO'], undefined)).toBe('finance');
  });

  it('cai no enum legado quando não há role v2 mapeada', () => {
    expect(resolveProfile([], 'PRODUCTION')).toBe('production');
    expect(resolveProfile(['ROLE_NOVA_DESCONHECIDA'], 'COMMERCIAL')).toBe('commercial');
    expect(resolveProfile(undefined, 'SUPER_ADMIN')).toBe('executive');
  });

  it('mapeia os enums legados conhecidos', () => {
    expect(resolveProfile([], 'DIRECTOR')).toBe('executive');
    expect(resolveProfile([], 'MANAGER')).toBe('operations');
    expect(resolveProfile([], 'QUALITY')).toBe('production');
    expect(resolveProfile([], 'FINANCIAL')).toBe('finance');
    expect(resolveProfile([], 'WAREHOUSE')).toBe('logistics');
    expect(resolveProfile([], 'STORE')).toBe('logistics');
  });

  it('sem nada reconhecível → default', () => {
    expect(resolveProfile([], undefined)).toBe('default');
    expect(resolveProfile(['X'], 'READER')).toBe('default');
    expect(resolveProfile(undefined, undefined)).toBe('default');
  });

  it('todo perfil retornável tem template', () => {
    const returnable: WorkspaceProfile[] = [
      resolveProfile(['DIRETOR'], undefined),
      resolveProfile(['COMPRADOR'], undefined),
      resolveProfile(['ALMOXARIFE'], undefined),
      resolveProfile([], 'MANAGER'),
      resolveProfile([], undefined),
    ];
    for (const p of returnable) {
      expect(TEMPLATES[p]).toBeDefined();
    }
  });
});
