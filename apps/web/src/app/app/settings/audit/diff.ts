/**
 * Trilha de auditoria: transforma o diff bruto do AuditLogV2 (oldValue /
 * newValue, JSON) em algo que uma pessoa lê — pedido do Rafael (11/08/2026):
 * "quando eu expando aparece um código; tem que mudar a visualização".
 *
 * Funções puras (testadas em diff.spec.ts); a página só renderiza.
 */

export type TipoDeMudanca = 'criado' | 'removido' | 'alterado' | 'vazio';

export interface CampoDoDiff {
  campo: string;
  antes: string | null;
  depois: string | null;
}

export interface DiffLegivel {
  tipo: TipoDeMudanca;
  campos: CampoDoDiff[];
}

function ehObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Valor de UM campo, em texto curto e humano.
 * Estruturas aninhadas viram resumo compacto (sem chaves/aspas de JSON),
 * porque o nível de cima já dá o contexto.
 */
export function valorLegivel(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(vazio)';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    // Datas ISO ficam mais curtas: 2026-08-11T14:03:22.000Z -> 11/08/2026 14:03
    const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]} ${iso[4]}:${iso[5]}`;
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '(lista vazia)';
    return v.map((item) => valorLegivel(item)).join('; ');
  }
  if (ehObjetoPlano(v)) {
    return Object.entries(v)
      .map(([k, val]) => `${k}: ${valorLegivel(val)}`)
      .join(', ');
  }
  return String(v);
}

/**
 * Compara oldValue/newValue campo a campo (nível de cima) e devolve só o que
 * interessa: em criação/remoção, todos os campos com valor; em alteração,
 * SOMENTE os campos que mudaram.
 */
export function diffLegivel(oldValue: unknown, newValue: unknown): DiffLegivel {
  const antes = ehObjetoPlano(oldValue) ? oldValue : null;
  const depois = ehObjetoPlano(newValue) ? newValue : null;

  if (!antes && !depois) {
    // Diff não estruturado (escalar/array na raiz) — mostra como campo único.
    if (oldValue != null || newValue != null) {
      return {
        tipo: oldValue == null ? 'criado' : newValue == null ? 'removido' : 'alterado',
        campos: [
          {
            campo: 'valor',
            antes: oldValue == null ? null : valorLegivel(oldValue),
            depois: newValue == null ? null : valorLegivel(newValue),
          },
        ],
      };
    }
    return { tipo: 'vazio', campos: [] };
  }

  if (!antes && depois) {
    return {
      tipo: 'criado',
      campos: Object.entries(depois).map(([campo, v]) => ({
        campo,
        antes: null,
        depois: valorLegivel(v),
      })),
    };
  }

  if (antes && !depois) {
    return {
      tipo: 'removido',
      campos: Object.entries(antes).map(([campo, v]) => ({
        campo,
        antes: valorLegivel(v),
        depois: null,
      })),
    };
  }

  const chaves = [...new Set([...Object.keys(antes!), ...Object.keys(depois!)])].sort();
  const campos: CampoDoDiff[] = [];
  for (const campo of chaves) {
    const a = antes![campo];
    const d = depois![campo];
    if (JSON.stringify(a) === JSON.stringify(d)) continue; // não mudou: não polui
    campos.push({ campo, antes: valorLegivel(a), depois: valorLegivel(d) });
  }
  return { tipo: 'alterado', campos };
}

export const TITULO_POR_TIPO: Record<TipoDeMudanca, string> = {
  criado: 'Registro criado com os dados:',
  removido: 'Registro removido. Dados que existiam:',
  alterado: 'O que mudou:',
  vazio: 'Sem detalhes registrados.',
};
