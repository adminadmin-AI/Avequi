/**
 * Single-flight: enquanto uma execução está em andamento, chamadas novas
 * recebem a MESMA promessa em vez de disparar outra.
 *
 * Existe para a renovação de sessão. O backend rotaciona o refresh token
 * (revoga o antigo a cada uso), então duas renovações simultâneas se
 * destroem: a primeira invalida o token que a segunda está apresentando, e a
 * segunda recebe 401 — logout no meio do trabalho. E simultâneo é o caso
 * COMUM, não o raro: quando o access expira, todas as queries da tela levam
 * 401 no mesmo instante.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let emAndamento: Promise<T> | null = null;

  return () => {
    if (emAndamento) return emAndamento;
    emAndamento = fn().finally(() => {
      // Libera para a PRÓXIMA vez (a expiração seguinte, daqui a 15 min) —
      // sem isto o resultado ficaria cacheado para sempre.
      emAndamento = null;
    });
    return emAndamento;
  };
}
