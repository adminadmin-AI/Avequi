import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient, limparSessao, salvarSessao } from '@/lib/api-client';

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
        // Mesma porta de entrada do refresh: grava o par completo. Guardar
        // só o access foi o que derrubava a sessão a cada ~30 min.
        salvarSessao(data);
        set({ user: data.user, isAuthenticated: true });
        return { passwordChangeRequired: false as const };
      },

      logout: async () => {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          try {
            await apiClient.post('/auth/logout', { refreshToken });
          } catch {}
        }
        limparSessao();
        set({ user: null, isAuthenticated: false });
      },
    }),
    { name: 'gdr-auth' },
  ),
);
