/**
 * Troca de senha (#735/#736) — helpers puros compartilhados entre o fluxo
 * FORÇADO (primeiro acesso / senha vencida: login devolve passwordChangeToken
 * restrito de 10 min em vez dos tokens finais) e o VOLUNTÁRIO (usuário logado
 * com Bearer + senha atual).
 *
 * O handoff login → /change-password vai via sessionStorage (não URL: token
 * em querystring vaza em histórico/logs). O registro carrega um carimbo de
 * expiração espelhando o TTL do token no backend — expirou, volta ao login.
 */

export const PENDING_PASSWORD_CHANGE_KEY = 'avequi:pending-password-change';

/** TTL do passwordChangeToken no backend (#345) — 10 minutos. */
export const PASSWORD_CHANGE_TOKEN_TTL_MS = 10 * 60 * 1000;

export interface PendingPasswordChange {
  passwordChangeToken: string;
  email: string;
  /** true = senha venceu por rotação; false/ausente = primeiro acesso (mustChangePassword). */
  passwordExpired?: boolean;
}

interface StoredPendingChange extends PendingPasswordChange {
  expiresAt: number;
}

/** Storage mínimo (sessionStorage em produção; injetável nos testes). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function storePendingPasswordChange(
  storage: KeyValueStorage,
  pending: PendingPasswordChange,
  now: number = Date.now(),
): void {
  const record: StoredPendingChange = {
    ...pending,
    expiresAt: now + PASSWORD_CHANGE_TOKEN_TTL_MS,
  };
  storage.setItem(PENDING_PASSWORD_CHANGE_KEY, JSON.stringify(record));
}

/**
 * Lê e valida o handoff. Registro ausente, corrompido ou expirado → null
 * (e o registro é removido — token vencido não serve para nada).
 */
export function readPendingPasswordChange(
  storage: KeyValueStorage,
  now: number = Date.now(),
): PendingPasswordChange | null {
  const raw = storage.getItem(PENDING_PASSWORD_CHANGE_KEY);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as StoredPendingChange;
    if (
      typeof record?.passwordChangeToken !== 'string' ||
      typeof record?.email !== 'string' ||
      typeof record?.expiresAt !== 'number' ||
      record.expiresAt <= now
    ) {
      storage.removeItem(PENDING_PASSWORD_CHANGE_KEY);
      return null;
    }
    return {
      passwordChangeToken: record.passwordChangeToken,
      email: record.email,
      passwordExpired: record.passwordExpired,
    };
  } catch {
    storage.removeItem(PENDING_PASSWORD_CHANGE_KEY);
    return null;
  }
}

export function clearPendingPasswordChange(storage: KeyValueStorage): void {
  storage.removeItem(PENDING_PASSWORD_CHANGE_KEY);
}

/**
 * Traduz o erro do POST /auth/change-password em mensagem amigável.
 * A política de senha (#345) responde 400 com message string OU array de
 * strings (o que faltou, já em PT-BR) — array vira lista em linhas.
 */
export function resolveChangePasswordError(err: unknown): string {
  const e = err as {
    response?: { status?: number; data?: { message?: string | string[] } };
    code?: string;
    message?: string;
  };
  if (e?.code === 'ERR_NETWORK' || (e?.message && /network/i.test(e.message))) {
    return 'Servidor indisponível no momento. Tente novamente em instantes.';
  }
  const apiMessage = e?.response?.data?.message;
  if (Array.isArray(apiMessage)) return apiMessage.join('\n');
  if (typeof apiMessage === 'string' && apiMessage) return apiMessage;
  const status = e?.response?.status;
  if (status === 401) return 'Credencial inválida ou expirada. Faça login novamente.';
  if (status === 429) return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
  if (status && status >= 500) return 'Erro no servidor. Tente novamente em instantes.';
  return 'Não foi possível alterar a senha. Tente novamente.';
}
