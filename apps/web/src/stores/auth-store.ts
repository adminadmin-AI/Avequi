import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient, limparCredenciaisLocais, salvarCsrfToken } from '@/lib/api-client';

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
  | { passwordChangeRequired: false }
  | { passwordChangeRequired: true; passwordChangeToken: string; passwordExpired: boolean };

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
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
        // #349: a sessão vive em cookies httpOnly setados pelo servidor —
        // tokens NÃO são mais gravados no localStorage. Só o csrfToken
        // (não-segredo de autenticação) fica local, p/ o header x-csrf-token.
        salvarCsrfToken(data.csrfToken);
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
