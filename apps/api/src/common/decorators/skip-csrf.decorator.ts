import { SetMetadata } from '@nestjs/common';

/**
 * Isenta a rota do CsrfGuard (#349).
 *
 * Reservado às rotas que PRECISAM funcionar mesmo com o segredo de CSRF
 * perdido — senão o usuário fica trancado: com `gdr_access` ainda válido no
 * cookie, toda mutação dá 403, e como `gdr_csrf` é httpOnly ele não consegue
 * limpar nada pelo navegador. Sem isenção, nem `login` (para reautenticar)
 * nem `logout` (para sair) respondem, e a espera é até o access expirar.
 *
 * Só entram aqui rotas cujo CSRF teria impacto baixo:
 * - `login` / `mfa/verify`: forçar um login cross-site não dá acesso a nada
 *   da vítima (o atacante não lê a resposta e não rouba a sessão dela);
 * - `logout`: o pior caso é deslogar alguém — irritante, não perigoso, e o
 *   preço de não ter é o trancamento acima.
 *
 * `refresh` NÃO entra: forçar a rotação do refresh token derrubaria a sessão
 * da vítima de verdade (negação de serviço), então ele continua protegido.
 */
export const SKIP_CSRF_KEY = 'skipCsrf';
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
