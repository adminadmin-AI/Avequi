import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  apiClient,
  confirmarCanalDeSessao,
  limparCredenciaisLocais,
  registrarSessao,
} from '@/lib/api-client';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId: string;
}

/**
 * Resultado do login (#735): quando o backend exige troca de senha (primeiro
 * acesso com mustChangePassword ou senha vencida por rotação, #345), o
 * /auth/login NÃO devolve tokens finais — devolve um passwordChangeToken
 * restrito (10 min, só aceito pelo POST /auth/change-password). Nesse caso
 * NADA é gravado no localStorage e o caller redireciona para a tela de
 * definição de nova senha.
 */
export type LoginResult =
  | { passwordChangeRequired: false; mfaRequired?: false }
  | { passwordChangeRequired: true; passwordChangeToken: string; passwordExpired: boolean }
  // #344 (OPS F2): usuário com MFA ativo não recebe tokens no 1º passo —
  // recebe o desafio (mfaPendingToken, 2 min) e troca por tokens no verify.
  | { passwordChangeRequired: false; mfaRequired: true; mfaPendingToken: string };

/** Resultado do 2º passo do login MFA — o gate de senha (#345) roda DEPOIS
 *  do segundo fator, então o verify também pode exigir troca de senha. */
export type MfaVerifyResult =
  | { passwordChangeRequired: false }
  | { passwordChangeRequired: true; passwordChangeToken: string; passwordExpired: boolean };

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (mfaPendingToken: string, code: string) => Promise<MfaVerifyResult>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,

      login: async (email, password) => {
        const { data } = await apiClient.post('/auth/login', { email, password });
        // Troca de senha obrigatória (#735): sem tokens finais — antes deste
        // guard o accessToken era gravado como a string "undefined" e o
        // usuário "entrava e caía" de volta no login.
        if (data.passwordChangeRequired) {
          return {
            passwordChangeRequired: true as const,
            passwordChangeToken: data.passwordChangeToken as string,
            passwordExpired: !!data.passwordExpired,
          };
        }
        // MFA ativo (#344): a resposta traz só o desafio — SEM tokens finais.
        // Mesma armadilha do #735: sem este guard o front "logava" sem
        // credencial nenhuma e o usuário caía de volta no login. Ninguém
        // pisou nela até hoje porque o primeiro usuário com MFA ativo só
        // apareceu no OPS F2 (portal exige MFA duro).
        if (data.mfaRequired) {
          return {
            passwordChangeRequired: false as const,
            mfaRequired: true as const,
            mfaPendingToken: data.mfaPendingToken as string,
          };
        }
        // #349: a sessão vive em cookies httpOnly setados pelo servidor e o
        // front guarda só o csrfToken (não-segredo de autenticação). Se a
        // resposta vier SEM csrfToken, a API ainda é anterior ao #349 —
        // `registrarSessao` cai no canal Bearer em vez de deixar o usuário
        // logado sem credencial nenhuma (janela de deploy web-antes-de-API).
        if (registrarSessao(data) === 'cookie') {
          // Browser pode ter descartado o cookie (bloqueio de terceiros —
          // Safari por padrão). Confirma com o servidor e, se for o caso,
          // resgata a sessão no canal Bearer antes de liberar o app.
          await confirmarCanalDeSessao(data);
        }
        set({ user: data.user, isAuthenticated: true });
        return { passwordChangeRequired: false as const };
      },

      // 2º passo do login MFA (#344, OPS F2): troca mfaPendingToken + código
      // TOTP/backup pelos tokens finais — a partir daqui o caminho é IGUAL ao
      // do login sem MFA (cookies + confirmação de canal do #349/#906).
      verifyMfa: async (mfaPendingToken, code) => {
        const { data } = await apiClient.post('/auth/mfa/verify', { mfaPendingToken, code });
        // Gate de senha roda DEPOIS do 2º fator (#345 — não vaza estado de
        // senha antes do MFA): o verify também pode exigir troca.
        if (data.passwordChangeRequired) {
          return {
            passwordChangeRequired: true as const,
            passwordChangeToken: data.passwordChangeToken as string,
            passwordExpired: !!data.passwordExpired,
          };
        }
        if (registrarSessao(data) === 'cookie') {
          await confirmarCanalDeSessao(data);
        }
        set({ user: data.user, isAuthenticated: true });
        return { passwordChangeRequired: false as const };
      },

      logout: async () => {
        try {
          // Cookie httpOnly leva o refresh; body cobre sessão legada
          // (pré-cookie) que ainda tenha token no localStorage.
          const legado = localStorage.getItem('refreshToken');
          await apiClient.post('/auth/logout', legado ? { refreshToken: legado } : {});
        } catch {}
        limparCredenciaisLocais();
        set({ user: null, isAuthenticated: false });
      },
    }),
    { name: 'gdr-auth' },
  ),
);
