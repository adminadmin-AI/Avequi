/**
 * OPS WP7 (#914) — hardening compartilhado do control plane.
 *
 * Throttle DEDICADO das rotas /ops: metade do teto global (60 req/60s em
 * app.module). Painel de back-office não tem tela que precise de rajada —
 * quem estoura 30 req/min aqui é script, não operador. Aplicado por classe
 * em TODO controller protegido do módulo (o sweep de isolamento garante).
 */
export const OPS_THROTTLE = { default: { limit: 30, ttl: 60_000 } } as const;
