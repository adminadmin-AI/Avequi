# SSO Readiness — Preparação OAuth/SSO (IAM v2 F4.3, issue #346)

> **Status: PREPARAÇÃO CONCLUÍDA, NENHUM PROVIDER EXTERNO IMPLEMENTADO.**
> Este documento explica, em linguagem simples, o que já está pronto na
> arquitetura para receber login com Google/Microsoft/SAML no futuro, o que
> ainda falta para ligar um provider de verdade, e quais decisões dependem
> do Rafael.

---

## 1. O que é SSO e por que preparamos agora

**SSO (Single Sign-On)** = entrar no ERP usando uma conta que já existe em
outro lugar (Google Workspace, Microsoft 365/Entra ID etc.), em vez de
e-mail+senha cadastrados no próprio ERP. A GDR pode crescer e precisar de
SSO corporativo; preparar a arquitetura agora evita um rewrite caro depois
(gap G12 do documento `ARQUITETURA-IAM-V2.md`).

**O que esta fase NÃO fez (de propósito, conforme a issue #346):**
- Nenhum fluxo OAuth (redirect, callback, troca de code por token);
- Nenhuma integração com Google/Microsoft;
- Nenhum SAML/LDAP/WebAuthn.

---

## 2. O que já está pronto (entregue nesta fase)

### 2.1 Banco de dados (migração 100% aditiva)

| Objeto | O que é |
|---|---|
| enum `IdentityProviderType` | `LOCAL`, `GOOGLE`, `MICROSOFT`, `SAML`. **MICROSOFT cobre o Entra ID (ex-Azure AD)** — não criamos um valor `AZURE_AD` separado porque é o mesmo serviço renomeado. |
| `gdr_user_identities` (model `UserIdentity`) | Vínculo usuário ↔ identidade externa: `userId`, `provider`, `providerUserId` (o `sub` do OIDC / NameID do SAML), `email`, `metadata` JSON, timestamps. `UNIQUE (provider, providerUserId)`. Um usuário pode ter **várias** identidades (senha local + Google, por exemplo). |
| `gdr_auth_provider_configs` (model `AuthProviderConfig`) | Configuração de provider **por empresa**: `type`, `config` JSON (clientId público, domínio permitido…), `enabled` (nasce **false**), `companyId`. `UNIQUE (companyId, type)`. **Segredos (clientSecret) NÃO entram no JSON** — ficam em env vars. |

**Por que uma tabela de identidades em vez dos campos `authProvider`/`externalId`
no User (sugestão original da issue)?** Porque a tabela suporta N identidades
por usuário e não mexe em nada do model `User`. A issue pedia "campos no
schema" — a tabela entrega o mesmo dado, melhor normalizado.

**`User.passwordHash` continua obrigatório (NOT NULL).** Contas criadas via
SSO (JIT) nascem com uma **senha aleatória inutilizável** (hash bcrypt de 48
bytes aleatórios — padrão comum da indústria): o login por senha dessas contas
simplesmente nunca valida. Tornar o campo nullable exigiria revisar todo
código que assume a presença do hash — fica como decisão futura, se um dia
valer a pena.

### 2.2 Ponto de extensão no código (`apps/api/src/modules/auth/providers/`)

```
identity-provider.interface.ts   → contrato IdentityProvider + IdentityProfile
local.identity-provider.ts       → provider LOCAL (delega ao AuthService atual)
identity-provider.registry.ts    → registro central; resolve(type) / listEnabled()
sso-jit-provisioning.service.ts  → JIT provisioning (desligado por default)
```

- **`IdentityProvider`**: interface com `validateOrProvision(profile) → user | null`.
  O provider responde apenas "**quem** é este usuário?" — quem emite tokens
  continua sendo o `AuthService` (com todos os gates existentes: lockout,
  MFA, password policy). Isso garante que **qualquer** provider futuro herda
  os controles de segurança automaticamente.
- **`LocalIdentityProvider`**: o fluxo de e-mail+senha de hoje, expresso como
  provider. Refatoração mínima: ele **delega** ao `AuthService.validateUser`
  existente; o `LocalStrategy` do Passport não mudou — **zero regressão**.
- **`IdentityProviderRegistry`**: mapa `type → provider`. Provider desconhecido
  ou desabilitado → 400. `listEnabled()` alimenta o endpoint público.
- **`SsoJitProvisioningService`**: resolve identidades **externas** —
  1. identidade já vinculada → devolve o usuário;
  2. usuário existente com o mesmo e-mail → cria o vínculo (auto-link);
  3. usuário novo + JIT **desligado** → nega (null → 401 genérico);
  4. usuário novo + JIT **ligado** → cria usuário com perfil default + vínculo.

### 2.3 Endpoint placeholder

`GET /api/auth/sso/providers` (público) — lista os providers habilitados.
Hoje responde:

```json
{
  "providers": [{ "type": "LOCAL", "name": "E-mail e senha" }],
  "jitProvisioning": false
}
```

O frontend usará esta lista para renderizar os botões "Entrar com…" quando
existirem providers reais. **Não existe nenhuma rota de callback OAuth.**

### 2.4 Flags de ambiente (validadas no boot via Joi, defaults seguros)

| Env var | Default | O que faz |
|---|---|---|
| `SSO_JIT_PROVISIONING` | `false` | Liga/desliga a criação automática de usuários vindos de SSO. Desligado = SSO só autentica quem já existe. |
| `SSO_JIT_DEFAULT_ROLE` | `READER` | Perfil das contas criadas por JIT. **`SUPER_ADMIN` é proibido** (o Joi rejeita no boot e o serviço cai para `READER` em runtime). |
| `SSO_JIT_DEFAULT_COMPANY_ID` | — | Empresa das contas criadas por JIT. **Sem ela, o JIT não cria nada** (aborta com log de erro), mesmo ligado. |

---

## 3. Fluxo (como ficará quando um provider real existir)

```mermaid
flowchart TD
    A[Usuário clica 'Entrar com Google'] --> B[GET /auth/sso/google\n(FUTURO — não existe)]
    B --> C[Redirect para o Google\nOAuth 2.0 / OIDC]
    C --> D[Callback /auth/sso/google/callback\n(FUTURO — não existe)]
    D --> E[Passport GoogleStrategy valida\ncode → id_token → profile]
    E --> F{email_verified?}
    F -- não --> X1[401 genérico]
    F -- sim --> G[IdentityProviderRegistry\n.resolve(GOOGLE)]
    G --> H[SsoJitProvisioningService\n.resolveOrProvision(profile)]
    H --> I{Identidade em\ngdr_user_identities?}
    I -- sim --> M[Usuário encontrado]
    I -- não --> J{Usuário com\nmesmo e-mail?}
    J -- sim --> K[Auto-link: cria vínculo] --> M
    J -- não --> L{JIT ligado?}
    L -- não --> X2[401 genérico\nnão cria nada]
    L -- sim --> N[Cria usuário: perfil default,\nsenha inutilizável + vínculo] --> M
    M --> O[AuthService.login\nJÁ EXISTE: MFA gate →\npassword gate → tokens + sessão]
    O --> P[accessToken + refreshToken\nmesmo formato de hoje]
```

O trecho `M → O → P` é **exatamente o fluxo atual** — sessões, lockout, MFA,
password policy e auditoria valem para SSO sem nenhum código novo.

---

## 4. O que falta para ligar Google/Microsoft (checklist futuro)

Passo a passo para implementar um provider real (ex.: Google):

1. **Cadastro no provider**
   - Google: criar projeto no Google Cloud Console → OAuth consent screen →
     credencial "OAuth 2.0 Client ID" (tipo Web).
   - Microsoft: registrar app no Entra ID (portal Azure) → Authentication →
     Web platform.
2. **Redirect URIs a cadastrar no provider**
   - Dev: `http://localhost:3001/api/auth/sso/google/callback`
   - Prod: `https://avequi-api-production.up.railway.app/api/auth/sso/google/callback`
   - (Microsoft: mesmos caminhos com `microsoft` no lugar de `google`.)
3. **Env vars novas** (adicionar ao Joi como optional):
   - `SSO_GOOGLE_CLIENT_ID`, `SSO_GOOGLE_CLIENT_SECRET`
   - `SSO_MICROSOFT_CLIENT_ID`, `SSO_MICROSOFT_CLIENT_SECRET`, `SSO_MICROSOFT_TENANT_ID`
   - `SSO_ALLOWED_DOMAINS` (ex.: `gdrreboques.com.br`) — recusar contas fora do domínio.
4. **Dependências npm**: `passport-google-oauth20` (+ `@types/…`) ou
   `passport-azure-ad` / `openid-client` para Microsoft.
5. **Código novo** (nenhuma mudança no que já existe):
   - `GoogleStrategy extends PassportStrategy(Strategy, 'google')` em
     `auth/strategies/`;
   - `GoogleIdentityProvider implements IdentityProvider` em `auth/providers/`
     — `isEnabled()` lê a env var / `gdr_auth_provider_configs`;
     `validateOrProvision` chama o `SsoJitProvisioningService`;
   - registrar o provider no `IdentityProviderRegistry` (uma linha no
     construtor ou `registry.register(...)` no módulo);
   - rotas `GET /auth/sso/:provider` (redirect) e
     `GET /auth/sso/:provider/callback` no `AuthController`;
   - **checar `email_verified === true`** antes do auto-link por e-mail
     (proteção contra account takeover via e-mail não verificado).
6. **Frontend**: botão "Entrar com Google" na tela de login (a lista vem de
   `GET /auth/sso/providers`); tratamento do retorno (tokens no fragmento ou
   cookie — decidir na implementação).
7. **Habilitar por empresa**: criar registro em `gdr_auth_provider_configs`
   com `enabled=true` (hoje não há CRUD — pode ser seed/SQL direto ou uma
   tela de admin futura).
8. **Testes**: estratégia mockada + fluxo callback (o registry e o JIT já
   têm cobertura).

**SAML** (se algum cliente corporativo exigir): mesmo desenho, com
`passport-saml`; o `providerUserId` recebe o NameID.

---

## 5. Decisões pendentes do Rafael

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| 1 | **Quais providers ligar?** | Google / Microsoft / SAML / nenhum por ora | Nenhum por ora; Google primeiro quando houver demanda (a GDR usa Gmail corporativo?) |
| 2 | **Domínio permitido** | Restringir a `@gdrreboques.com.br` (ou domínios da GDR) vs. aceitar qualquer conta | Restringir por domínio — SSO aberto a qualquer Gmail é risco |
| 3 | **JIT on/off** | Desligado (só autentica quem já existe) vs. ligado (cria conta nova com perfil default) | Manter **desligado**: com ~dezenas de usuários, criar contas manualmente é mais seguro e o custo é baixo |
| 4 | **Perfil default do JIT** (se ligado) | Qualquer perfil exceto SUPER_ADMIN | `READER` (default atual) |
| 5 | **`passwordHash` nullable no futuro?** | Manter senha inutilizável vs. permitir contas sem senha | Manter senha inutilizável (zero mudança no código existente) |

---

## 6. Referências

- Issue: [#346 — Preparação para OAuth/SSO](https://github.com/adminadmin-AI/Avequi/issues/346)
- Arquitetura geral: `docs/iam/ARQUITETURA-IAM-V2.md` (branch `iam/f0-arquitetura`), Bloco E
- Código: `apps/api/src/modules/auth/providers/`
- Migração: `apps/api/prisma/migrations/20260704004000_iam_f8_sso_prep/`
