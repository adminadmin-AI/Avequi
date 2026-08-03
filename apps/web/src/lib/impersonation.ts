import { apiClient } from '@/lib/api-client';
import type { ImpersonateResult } from '@/types/api';

/**
 * Mecânica client-side da sessão de "Ver como" (impersonation) — OPS WP6
 * (#913). O backend entrega um accessToken do ALVO (válido 30min, sem
 * refresh — a sessão é somente-leitura e qualquer mutação volta 403) que
 * substitui o do operador enquanto dura o suporte.
 *
 * Duas chaves no localStorage sustentam o ciclo:
 * - `avequi:op-backup`: par accessToken/refreshToken do OPERADOR, guardado
 *   antes da troca — sem isto não há como voltar a ser ele mesmo.
 * - `avequi:impersonation`: metadados da sessão ativa (iid, tenantId, alvo,
 *   expiresAt) — é o que o banner e o `isActive()` leem.
 *
 * `start()` navega com `window.location.assign` de propósito: um reload
 * limpo garante que nenhum estado em memória (stores, cache do React Query)
 * do operador sobrevive à troca de identidade.
 */

const OP_BACKUP_KEY = 'avequi:op-backup';
const IMPERSONATION_KEY = 'avequi:impersonation';
const ACCESS_KEY = 'accessToken';
const REFRESH_KEY = 'refreshToken';

export interface ImpersonationSession {
  iid: string;
  tenantId: string;
  targetName: string;
  targetEmail: string;
  expiresAt: string;
}

interface OperatorBackup {
  accessToken: string | null;
  refreshToken: string | null;
}

function readJSON<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Inicia a sessão: faz backup dos tokens do operador, troca o accessToken
 * pelo do alvo (removendo o refreshToken — a sessão não se renova sozinha),
 * grava os metadados que o banner exibe e navega para `/app`.
 */
export function start(result: ImpersonateResult, tenantId: string): void {
  if (typeof window === 'undefined') return;

  const backup: OperatorBackup = {
    accessToken: localStorage.getItem(ACCESS_KEY),
    refreshToken: localStorage.getItem(REFRESH_KEY),
  };
  localStorage.setItem(OP_BACKUP_KEY, JSON.stringify(backup));

  localStorage.setItem(ACCESS_KEY, result.impersonationToken);
  localStorage.removeItem(REFRESH_KEY);

  const session: ImpersonationSession = {
    iid: result.iid,
    tenantId,
    targetName: result.target.name,
    targetEmail: result.target.email,
    expiresAt: result.expiresAt,
  };
  localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(session));

  window.location.assign('/app');
}

/** Sessão de impersonation ativa neste navegador, se houver. */
export function isActive(): ImpersonationSession | null {
  return readJSON<ImpersonationSession>(IMPERSONATION_KEY);
}

/**
 * Restaura os tokens do operador a partir do backup e limpa as duas chaves
 * de controle. Não faz rede nem navega — é o núcleo compartilhado por
 * `endLocal()` e `end()`. Devolve a sessão que estava ativa (para quem
 * chamou decidir para onde navegar).
 */
function restoreOperatorTokens(): ImpersonationSession | null {
  if (typeof window === 'undefined') return null;

  const session = isActive();
  const backup = readJSON<OperatorBackup>(OP_BACKUP_KEY);

  if (backup?.accessToken) localStorage.setItem(ACCESS_KEY, backup.accessToken);
  else localStorage.removeItem(ACCESS_KEY);

  if (backup?.refreshToken) localStorage.setItem(REFRESH_KEY, backup.refreshToken);
  else localStorage.removeItem(REFRESH_KEY);

  localStorage.removeItem(OP_BACKUP_KEY);
  localStorage.removeItem(IMPERSONATION_KEY);

  return session;
}

/**
 * Encerramento só local (sem chamar o backend): restaura o operador e
 * navega de volta para a conta. Útil quando não há como (ou não vale a
 * pena) avisar o servidor — o token do alvo expira sozinho de qualquer jeito.
 */
export function endLocal(): void {
  const session = restoreOperatorTokens();
  if (typeof window !== 'undefined') {
    window.location.assign(session ? `/app/ops/${session.tenantId}` : '/app/ops');
  }
}

/**
 * Encerramento "de verdade": restaura os tokens do operador PRIMEIRO — o
 * POST de encerramento precisa estar autenticado como o operador, já que
 * mutações sob impersonation voltam 403 — e só então avisa o backend. A
 * chamada é best-effort: se falhar, a sessão segue encerrada localmente e
 * o token do alvo expira sozinho em até 30min.
 */
export async function end(): Promise<void> {
  const session = restoreOperatorTokens();

  if (session) {
    try {
      await apiClient.post(`/ops/tenants/${session.tenantId}/impersonation/${session.iid}/end`);
    } catch {
      /* best-effort — o token do alvo expira sozinho */
    }
  }

  if (typeof window !== 'undefined') {
    window.location.assign(session ? `/app/ops/${session.tenantId}` : '/app/ops');
  }
}
