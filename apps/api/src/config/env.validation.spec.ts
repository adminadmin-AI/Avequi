import { envValidationSchema } from './env.validation';

/**
 * Testes do schema de validação de env vars (#202).
 * Mesmo comportamento aplicado pelo ConfigModule no boot da API.
 */

const VALID_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/gdr',
  DIRECT_URL: 'postgresql://user:pass@localhost:5432/gdr',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  REDIS_URL: 'redis://localhost:6379',
};

function validate(env: Record<string, unknown>) {
  return envValidationSchema.validate(env, {
    abortEarly: false,
    allowUnknown: true,
  });
}

describe('envValidationSchema (#202)', () => {
  it('aceita um conjunto mínimo válido de variáveis', () => {
    const { error } = validate(VALID_ENV);
    expect(error).toBeUndefined();
  });

  it('aplica defaults sensatos (JWT_EXPIRY, JWT_REFRESH_EXPIRY, API_PORT, WEB_URL)', () => {
    const { value } = validate(VALID_ENV);
    expect(value.JWT_EXPIRY).toBe('15m');
    expect(value.JWT_REFRESH_EXPIRY).toBe('7d');
    expect(value.API_PORT).toBe(3001);
    expect(value.API_PREFIX).toBe('api');
    expect(value.WEB_URL).toBe('http://localhost:3000');
    expect(value.FOCUS_NFE_BASE_URL).toBe('https://homologacao.focusnfe.com.br');
  });

  it('permite variáveis desconhecidas (envs de plataforma: Railway, Docker, CI)', () => {
    const { error } = validate({ ...VALID_ENV, RAILWAY_ENVIRONMENT: 'production', PATH: '/usr/bin' });
    expect(error).toBeUndefined();
  });

  describe('JWT_REFRESH_SECRET', () => {
    it('falha quando ausente (evita refresh token assinado com undefined)', () => {
      const { JWT_REFRESH_SECRET: _omit, ...env } = VALID_ENV;
      const { error } = validate(env);
      expect(error).toBeDefined();
      expect(error!.message).toContain('JWT_REFRESH_SECRET');
    });

    it('falha quando tem menos de 32 caracteres', () => {
      const { error } = validate({ ...VALID_ENV, JWT_REFRESH_SECRET: 'curto' });
      expect(error).toBeDefined();
      expect(error!.details.some((d) => d.path[0] === 'JWT_REFRESH_SECRET')).toBe(true);
    });

    it('falha quando é igual a JWT_SECRET', () => {
      const { error } = validate({
        ...VALID_ENV,
        JWT_REFRESH_SECRET: VALID_ENV.JWT_SECRET,
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('não pode ser igual a JWT_SECRET');
    });
  });

  describe('JWT_SECRET', () => {
    it('falha quando ausente', () => {
      const { JWT_SECRET: _omit, ...env } = VALID_ENV;
      const { error } = validate(env);
      expect(error).toBeDefined();
      expect(error!.details.some((d) => d.path[0] === 'JWT_SECRET')).toBe(true);
    });

    it('falha quando tem menos de 32 caracteres', () => {
      const { error } = validate({ ...VALID_ENV, JWT_SECRET: 'x'.repeat(31) });
      expect(error).toBeDefined();
    });
  });

  describe('expiries (JWT_EXPIRY / JWT_REFRESH_EXPIRY)', () => {
    it.each(['15m', '1h', '7d', '900', '30s'])('aceita formato válido %s', (v) => {
      const { error } = validate({ ...VALID_ENV, JWT_EXPIRY: v, JWT_REFRESH_EXPIRY: v });
      expect(error).toBeUndefined();
    });

    it('rejeita formato inválido', () => {
      const { error } = validate({ ...VALID_ENV, JWT_REFRESH_EXPIRY: 'sete dias' });
      expect(error).toBeDefined();
      expect(error!.details.some((d) => d.path[0] === 'JWT_REFRESH_EXPIRY')).toBe(true);
    });
  });

  describe('FOCUS_NFE_WEBHOOK_SECRET', () => {
    it('é opcional em development', () => {
      const { error } = validate({ ...VALID_ENV, NODE_ENV: 'development' });
      expect(error).toBeUndefined();
    });

    it('é obrigatório em produção', () => {
      const { error } = validate({ ...VALID_ENV, NODE_ENV: 'production' });
      expect(error).toBeDefined();
      expect(error!.message).toContain('FOCUS_NFE_WEBHOOK_SECRET');
    });

    it('passa em produção quando definido', () => {
      const { error } = validate({
        ...VALID_ENV,
        NODE_ENV: 'production',
        FOCUS_NFE_WEBHOOK_SECRET: 's'.repeat(24),
      });
      expect(error).toBeUndefined();
    });

    it('aceita string vazia em development (placeholder do .env.example)', () => {
      const { error } = validate({ ...VALID_ENV, FOCUS_NFE_WEBHOOK_SECRET: '' });
      expect(error).toBeUndefined();
    });

    it('rejeita string vazia em produção', () => {
      const { error } = validate({
        ...VALID_ENV,
        NODE_ENV: 'production',
        FOCUS_NFE_WEBHOOK_SECRET: '',
      });
      expect(error).toBeDefined();
    });

    it('rejeita secret muito curto (< 16 chars)', () => {
      const { error } = validate({
        ...VALID_ENV,
        FOCUS_NFE_WEBHOOK_SECRET: 'curtinho',
      });
      expect(error).toBeDefined();
    });
  });

  describe('BANK_ENCRYPTION_KEY', () => {
    it('é opcional (EncryptionService ainda não está no main)', () => {
      const { error } = validate(VALID_ENV);
      expect(error).toBeUndefined();
    });

    it('aceita 64 chars hex (32 bytes p/ AES-256-GCM)', () => {
      const { error } = validate({
        ...VALID_ENV,
        BANK_ENCRYPTION_KEY: 'ab'.repeat(32),
      });
      expect(error).toBeUndefined();
    });

    it('aceita string vazia (placeholder do .env.example)', () => {
      const { error } = validate({ ...VALID_ENV, BANK_ENCRYPTION_KEY: '' });
      expect(error).toBeUndefined();
    });

    it('rejeita chave com comprimento errado', () => {
      const { error } = validate({ ...VALID_ENV, BANK_ENCRYPTION_KEY: 'abcd1234' });
      expect(error).toBeDefined();
    });

    it('rejeita chave não-hex', () => {
      const { error } = validate({ ...VALID_ENV, BANK_ENCRYPTION_KEY: 'z'.repeat(64) });
      expect(error).toBeDefined();
    });
  });

  describe('URLs obrigatórias', () => {
    it.each(['DATABASE_URL', 'DIRECT_URL', 'REDIS_URL'])('falha quando %s está ausente', (key) => {
      const env: Record<string, unknown> = { ...VALID_ENV };
      delete env[key];
      const { error } = validate(env);
      expect(error).toBeDefined();
      expect(error!.details.some((d) => d.path[0] === key)).toBe(true);
    });

    it('rejeita DATABASE_URL que não é URI', () => {
      const { error } = validate({ ...VALID_ENV, DATABASE_URL: 'não é uma url' });
      expect(error).toBeDefined();
    });
  });
});
