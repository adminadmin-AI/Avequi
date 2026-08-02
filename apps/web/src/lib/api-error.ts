/**
 * Leitura de erros da API — helpers PUROS (sem React, sem axios), para as
 * telas distinguirem "não pode" de "não deu" sem repetir a mesma checagem
 * frágil em cada página.
 *
 * A distinção importa porque as duas falhas pedem coisas opostas: uma
 * negativa de permissão é definitiva (retentar só repete o 403 e faz o
 * usuário esperar à toa), enquanto uma falha de infraestrutura costuma
 * passar sozinha e merece um botão de "tentar de novo".
 */

interface ErroDeApi {
  response?: { status?: number; data?: { message?: unknown } };
}

/** 401/403 — o servidor entendeu e recusou; tentar de novo não muda nada. */
export function ehNegativaDeAcesso(erro: unknown): boolean {
  const status = (erro as ErroDeApi)?.response?.status;
  return status === 401 || status === 403;
}

/**
 * Mensagem que o backend mandou, quando existe e é apresentável.
 * O ValidationPipe devolve `message` como array — nesse caso junta as linhas.
 */
export function mensagemDoErro(erro: unknown): string | undefined {
  const msg = (erro as ErroDeApi)?.response?.data?.message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (Array.isArray(msg)) {
    const linhas = msg.filter((m): m is string => typeof m === 'string' && !!m.trim());
    if (linhas.length) return linhas.join('; ');
  }
  return undefined;
}
