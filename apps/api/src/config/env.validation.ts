import * as Joi from 'joi';

/**
 * Validação de variáveis de ambiente no bootstrap (#202 — Fase 0 Segurança).
 *
 * Este schema é aplicado pelo ConfigModule no boot da API. Se qualquer
 * variável obrigatória faltar ou estiver malformada, a API NÃO SOBE —
 * falhar alto no boot é mais seguro do que falhar silenciosamente em
 * runtime (ex.: assinar refresh tokens com `undefined` como secret).
 *
 * Regras importantes:
 * - JWT_REFRESH_SECRET é obrigatório, mínimo 32 chars e DIFERENTE de
 *   JWT_SECRET (usar o mesmo secret anula a separação access/refresh).
 * - FOCUS_NFE_WEBHOOK_SECRET é obrigatório em produção (sem ele o webhook
 *   fiscal rejeita todos os retornos da Focus NFe silenciosamente).
 * - BANK_ENCRYPTION_KEY: quando presente, precisa ser 64 chars hex
 *   (32 bytes para AES-256-GCM). Ainda não há consumidor no código
 *   (EncryptionService planejado) — por isso é opcional por enquanto;
 *   tornar obrigatório junto com o merge do EncryptionService.
 * - `allowUnknown: true` continua no ConfigModule: plataformas (Railway,
 *   Docker, CI) injetam variáveis próprias que não devem quebrar o boot.
 */

/** Formato aceito pelo jsonwebtoken/ms para expiração: 900, 15m, 1h, 7d... */
const JWT_EXPIRY_PATTERN = /^\d+(ms|s|m|h|d|w|y)?$/;

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // ─── Banco (Supabase/Postgres) ───
  DATABASE_URL: Joi.string().uri().required(),
  DIRECT_URL: Joi.string().uri().required(),

  // ─── JWT (access + refresh) ───
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRY: Joi.string().pattern(JWT_EXPIRY_PATTERN).default('15m'),
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .disallow(Joi.ref('JWT_SECRET'))
    .required()
    .messages({
      'any.invalid':
        'JWT_REFRESH_SECRET não pode ser igual a JWT_SECRET — use secrets distintos para access e refresh tokens',
      'any.required':
        'JWT_REFRESH_SECRET é obrigatório — sem ele os refresh tokens seriam assinados com secret indefinido',
    }),
  JWT_REFRESH_EXPIRY: Joi.string()
    .pattern(JWT_EXPIRY_PATTERN)
    .default('7d'),

  // #341 — minutos SEM NENHUMA requisição até a sessão morrer. Decisão de
  // negócio (terminal de fábrica pede curto; escritório talvez não), por isso
  // é env e não constante. Fora de 1..1440, o serviço cai no default de 15.
  SESSION_IDLE_TIMEOUT_MINUTES: Joi.number().integer().min(1).max(1440).optional(),

  // ─── Redis (Bull) ───
  REDIS_URL: Joi.string().uri().required(),

  // ─── API / CORS ───
  API_PORT: Joi.number().default(3001),
  API_PREFIX: Joi.string().default('api'),
  WEB_URL: Joi.string().uri().default('http://localhost:3000'),

  // ─── Focus NFe (fiscal) ───
  // #695 multi-emissor: token por company via env indexada
  // `FOCUS_NFE_TOKEN__<companyId>` (loja Guarapuava, CRD...). Chaves dinâmicas
  // passam pelo `allowUnknown: true`; o global abaixo é o fallback da matriz.
  FOCUS_NFE_TOKEN: Joi.string().allow('').optional(),
  FOCUS_NFE_BASE_URL: Joi.string()
    .uri()
    .default('https://homologacao.focusnfe.com.br'),
  // Obrigatório em produção: sem ele o webhook fiscal rejeita tudo
  // (fail-closed, porém silencioso — NF-e ficam presas em PROCESSING).
  FOCUS_NFE_WEBHOOK_SECRET: Joi.string()
    .min(16)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    })
    .messages({
      'any.required':
        'FOCUS_NFE_WEBHOOK_SECRET é obrigatório em produção — sem ele o webhook da Focus NFe rejeita todos os retornos',
    }),

  // ─── SERPRO BIN/RENAVE (#529-#532) ───
  // Todos opcionais: a integração é gateada pela flag Company.renaveEnabled
  // (OFF por default). Sem certificado, os adapters resolvem 'erro' brando.
  BIN_WS_BASE_URL: Joi.string()
    .uri()
    .default('https://hom.precadastro.estaleiro.serpro.gov.br'),
  RENAVE_WS_BASE_URL: Joi.string()
    .uri()
    .default('https://hom.renave.estaleiro.serpro.gov.br'),
  // e-CNPJ ICP-Brasil de máquina (mTLS do RENAVE-WS), PFX em base64
  RENAVE_CERT_PFX_BASE64: Joi.string().allow('').optional(),
  RENAVE_CERT_PASSPHRASE: Joi.string().allow('').optional(),

  // ─── SMTP transacional (#530 — e-mail da ATPV-e; primeiro mailer do repo) ───
  // Opcional: sem SMTP_HOST o MailService resolve { ok: false } sem lançar.
  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().optional(),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASS: Joi.string().allow('').optional(),
  SMTP_FROM: Joi.string().allow('').optional(),

  // ─── Suporte — issue no GitHub (#767) ───
  // Opcional: sem token/repo o GithubIssueService é no-op (o chamado funciona
  // normalmente, só não espelha no GitHub). Repo no formato "owner/repo".
  SUPPORT_GITHUB_TOKEN: Joi.string().allow('').optional(),
  SUPPORT_GITHUB_REPO: Joi.string()
    .pattern(/^[\w.-]+\/[\w.-]+$/)
    .allow('')
    .optional(),

  // ─── Suporte — write-back assinado da triagem (#768) ───
  // Segredo HMAC-SHA256 do PATCH /support/incidents/:id/diagnosis (runner→API).
  // Opcional no boot, mas o endpoint é FAIL-CLOSED: sem ele configurado, toda
  // requisição é rejeitada com 401 (nada de diagnóstico não-assinado entra).
  SUPPORT_TRIAGE_HMAC_SECRET: Joi.string().allow('').optional(),

  // ─── Criptografia de credenciais bancárias (AES-256-GCM) ───
  // 32 bytes = 64 chars hex. Opcional enquanto o EncryptionService não
  // está no main; o formato já é validado para evitar chave inválida.
  BANK_ENCRYPTION_KEY: Joi.string().hex().length(64).allow('').optional(),

  // ─── Regras que a main ganhou depois da extração (rebase 09/07) ───

  // #344: chave AES-256-GCM do EncryptionService (secret TOTP do MFA em
  // repouso; o futuro serviço bancário pode reutilizá-la). OPTIONAL de
  // propósito: "required se MFA estiver em uso" não é expressável no
  // boot — o fail-fast é em runtime (boot derruba se a chave existir
  // MALFORMADA; MFA responde 503 se a chave faltar). 64 hex = 32 bytes.
  ENCRYPTION_KEY: Joi.string()
    .pattern(/^[0-9a-fA-F]{64}$/)
    .optional()
    .messages({
      'string.pattern.base':
        'ENCRYPTION_KEY deve ter exatamente 64 caracteres hexadecimais (32 bytes)',
    }),

  // SoD (#160/#350): trava de segregação de funções nas aprovações.
  // DESLIGADA por padrão — regra vigente permite criar e aprovar.
  SOD_ENFORCE: Joi.boolean().default(false),

  // ─── Transcrição de áudio inbound do WhatsApp (F1 voz do SDR #506/#567) ───
  // OPENAI_API_KEY opcional: sem ela o TranscriptionService devolve null e o
  // SDR mantém o comportamento atual (avisa que vai passar pro vendedor). Com
  // ela, voice notes do lead são transcritas e entram no histórico do SDR.
  OPENAI_API_KEY: Joi.string().allow('').optional(),
  // Modelo de STT da OpenAI. Default barato; fallback documentado: 'whisper-1'.
  CRM_STT_MODEL: Joi.string().allow('').optional(),
});
