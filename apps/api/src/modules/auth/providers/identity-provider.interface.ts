import { IdentityProviderType } from '@prisma/client';

/**
 * IAM v2 — F4.3 (#346): Preparação OAuth/SSO — arquitetura extensível.
 *
 * Este arquivo define o PONTO DE EXTENSÃO para provedores de identidade.
 * Hoje só existe o provider LOCAL (e-mail + senha); Google/Microsoft/SAML
 * entram no futuro implementando esta MESMA interface, sem tocar no
 * AuthService. Ver docs/iam/SSO-READINESS.md para o passo-a-passo de como
 * adicionar um provider real.
 */

/**
 * Perfil de identidade normalizado — o "denominador comum" entre o login
 * local e os providers externos:
 *
 * - LOCAL: usa `email` + `credentials.password` (validados por bcrypt).
 * - SSO (futuro): usa `providerUserId` (claim `sub` do OIDC / NameID do
 *   SAML) + `email` verificado pelo provider; `credentials` fica vazio.
 */
export interface IdentityProfile {
  provider: IdentityProviderType;
  /** `sub` OIDC / NameID SAML — OBRIGATÓRIO para providers externos. */
  providerUserId?: string;
  email: string;
  /** Nome de exibição vindo do provider (usado no JIT provisioning). */
  name?: string;
  /** Credenciais locais — SÓ o provider LOCAL usa. */
  credentials?: { password?: string };
  /** Claims extras do provider (picture, hd, tid…) — vai para metadata JSON. */
  metadata?: Record<string, unknown>;
  /** Contexto da requisição (alimenta LoginAttempt/sessão). */
  context?: { ipAddress?: string; userAgent?: string };
}

/** Usuário autenticado devolvido pelos providers — SEM passwordHash. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  companyId: string;
  isActive: boolean;
  [key: string]: unknown;
}

/**
 * Contrato de todo provedor de identidade.
 *
 * `validateOrProvision` recebe um IdentityProfile e devolve o usuário local
 * correspondente (ou null quando a identidade não puder ser autenticada —
 * mesma semântica anti-enumeração do AuthService.validateUser: o chamador
 * responde um 401 genérico).
 *
 * IMPORTANTE: o provider NÃO emite tokens — quem emite continua sendo o
 * AuthService (login → MFA gate → password gate → issueTokens). O provider
 * responde apenas "QUEM é este usuário?", preservando todos os controles
 * já existentes (lockout, MFA, password policy) para qualquer provider.
 */
export interface IdentityProvider {
  readonly type: IdentityProviderType;
  /** Nome exibível no frontend (tela de login). */
  readonly displayName: string;
  /** Provider desligado não aparece em GET /auth/sso/providers nem resolve. */
  isEnabled(): boolean;
  validateOrProvision(profile: IdentityProfile): Promise<AuthenticatedUser | null>;
}
