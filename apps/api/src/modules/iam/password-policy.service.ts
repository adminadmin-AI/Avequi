import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Política de complexidade de senha (issue #345 — IAM v2 F4.2).
 * Valores default enterprise; centralizados aqui para virarem configuráveis
 * por empresa no futuro sem tocar nos consumidores.
 */
export interface PasswordPolicyConfig {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  /** Quantas senhas anteriores não podem ser reutilizadas. */
  historySize: number;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicyConfig = {
  minLength: 10,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecial: true,
  historySize: 5,
};

/**
 * Lista embutida das piores senhas (PT-BR + EN + padrões da empresa GDR).
 * Comparação case-insensitive e EXATA — complexidade já barra a maioria,
 * esta lista é defesa em profundidade contra variações que passam nas regras.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  [
    // ── EN — top offenders ──────────────────────────────────────────────
    'password', 'password1', 'password12', 'password123', 'password1234',
    'password!', 'password123!', 'p@ssw0rd', 'p@ssword', 'p@ssword123',
    'passw0rd', 'passw0rd!', 'password@123', 'p@ssw0rd123', 'p@ssw0rd!',
    '123456', '1234567', '12345678', '123456789', '1234567890',
    '12345678910', 'qwerty', 'qwerty123', 'qwerty1234', 'qwertyuiop',
    'abc123', 'abcd1234', 'abc123456', 'a123456789', 'aa123456789',
    'letmein', 'letmein123', 'welcome', 'welcome1', 'welcome123',
    'welcome@123', 'admin', 'admin123', 'admin1234', 'admin@123',
    'administrator', 'root', 'toor', 'guest', 'iloveyou', 'iloveyou1',
    'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball',
    'master', 'shadow', 'superman', 'batman', 'trustno1', 'hello123',
    'freedom', 'whatever', 'starwars', 'computer', 'internet',
    'zaq12wsx', 'qazwsx', 'qazwsxedc', '1q2w3e4r', '1q2w3e4r5t',
    '1qaz2wsx', 'q1w2e3r4', 'q1w2e3r4t5', 'asdfgh', 'asdfghjkl',
    'zxcvbnm', '111111', '11111111', '000000', '121212', '123123',
    '123123123', '654321', '666666', '696969', '112233', '987654321',
    'changeme', 'changeme123', 'default', 'temp123', 'temp1234',
    'test123', 'test1234', 'teste123', 'secret', 'secret123',
    // ── PT-BR ───────────────────────────────────────────────────────────
    'senha', 'senha123', 'senha1234', 'senha12345', 'senha@123',
    'senha@1234', 'senha123!', 'minhasenha', 'minhasenha123',
    'novasenha', 'novasenha123', 'mudarsenha', 'mudar123', 'trocar123',
    'trocarsenha', 'senhasegura', 'senhaforte', 'brasil', 'brasil123',
    'brasil2026', 'flamengo', 'flamengo123', 'corinthians', 'palmeiras',
    'saopaulo', 'gremio', 'cruzeiro', 'vasco123', 'futebol', 'futebol123',
    'amor123', 'deus123', 'deusefiel', 'jesus123', 'jesuscristo',
    'familia123', 'felicidade', 'bemvindo', 'bemvindo1', 'bemvindo123',
    'usuario123', 'teste1234', 'mudar@123',
    // ── Padrões da empresa (GDR / Avequi) ───────────────────────────────
    'gdr123', 'gdr1234', 'gdr12345', 'gdr@123', 'gdr@2025', 'gdr@2026',
    'gdr2025', 'gdr2026', 'gdr2027', 'gdrreboques', 'gdrreboques123',
    'gdr reboques', 'reboques', 'reboques123', 'avequi', 'avequi123',
    'avequi@123', 'avequi2025', 'avequi2026', 'avequi@2026', 'erp123',
    'erpavequi', 'guaratuba', 'guaratuba123',
  ].map((p) => p.toLowerCase()),
);

/**
 * PasswordPolicyService — issue #345 (IAM v2 Fase F4.2).
 *
 * Três responsabilidades:
 * 1. COMPLEXIDADE: valida a senha contra a política (mínimo 10 chars,
 *    maiúscula + minúscula + dígito + especial, lista de senhas comuns,
 *    não conter nome/e-mail do usuário) com mensagens PT-BR listando
 *    exatamente O QUE faltou.
 * 2. HISTÓRICO: bloqueia reuso das últimas 5 senhas (bcrypt compare contra
 *    gdr_password_history) e registra cada troca.
 * 3. ROTAÇÃO: expiração OPCIONAL por perfil (Role.passwordMaxAgeDays;
 *    null = sem rotação — DEFAULT, alinhado ao NIST SP 800-63B que
 *    recomenda CONTRA rotação periódica obrigatória).
 */
@Injectable()
export class PasswordPolicyService {
  private readonly logger = new Logger(PasswordPolicyService.name);
  private readonly policy = DEFAULT_PASSWORD_POLICY;

  constructor(private readonly prisma: PrismaService) {}

  /** Política vigente em formato público (GET /auth/password-policy). */
  getPolicy() {
    return {
      minLength: this.policy.minLength,
      maxLength: this.policy.maxLength,
      requireUppercase: this.policy.requireUppercase,
      requireLowercase: this.policy.requireLowercase,
      requireDigit: this.policy.requireDigit,
      requireSpecial: this.policy.requireSpecial,
      historySize: this.policy.historySize,
      description:
        `Mínimo de ${this.policy.minLength} caracteres, com pelo menos uma letra ` +
        'maiúscula, uma minúscula, um número e um caractere especial. Senhas ' +
        `comuns e as últimas ${this.policy.historySize} senhas não são aceitas.`,
    };
  }

  /**
   * Valida a complexidade. Lança BadRequestException com TODAS as regras que
   * falharam (mensagens PT-BR) — o usuário corrige tudo de uma vez.
   */
  validateComplexity(password: string, user?: { email?: string; name?: string }): void {
    const errors: string[] = [];
    const pwd = password ?? '';

    if (pwd.length < this.policy.minLength) {
      errors.push(`A senha deve ter no mínimo ${this.policy.minLength} caracteres.`);
    }
    if (pwd.length > this.policy.maxLength) {
      errors.push(`A senha deve ter no máximo ${this.policy.maxLength} caracteres.`);
    }
    if (this.policy.requireUppercase && !/[A-Z]/.test(pwd)) {
      errors.push('A senha deve conter pelo menos uma letra maiúscula (A-Z).');
    }
    if (this.policy.requireLowercase && !/[a-z]/.test(pwd)) {
      errors.push('A senha deve conter pelo menos uma letra minúscula (a-z).');
    }
    if (this.policy.requireDigit && !/[0-9]/.test(pwd)) {
      errors.push('A senha deve conter pelo menos um número (0-9).');
    }
    if (this.policy.requireSpecial && !/[^A-Za-z0-9]/.test(pwd)) {
      errors.push('A senha deve conter pelo menos um caractere especial (ex.: !@#$%&*).');
    }

    const lower = pwd.toLowerCase();
    if (lower && COMMON_PASSWORDS.has(lower)) {
      errors.push('Esta senha é muito comum e fácil de adivinhar. Escolha outra.');
    }

    if (user && lower) {
      const forbidden: string[] = [];
      if (user.email) {
        const localPart = user.email.split('@')[0]?.toLowerCase();
        if (localPart && localPart.length >= 3) forbidden.push(localPart);
      }
      if (user.name) {
        for (const token of user.name.toLowerCase().split(/\s+/)) {
          if (token.length >= 3) forbidden.push(token);
        }
      }
      if (forbidden.some((f) => lower.includes(f))) {
        errors.push('A senha não pode conter o seu nome ou o seu e-mail.');
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }
  }

  /**
   * Bloqueia reuso: compara (bcrypt) a senha nova contra as últimas N
   * entradas de gdr_password_history (inclui o hash da senha ATUAL — trocar
   * para a mesma senha também é rejeitado).
   */
  async assertNotReused(userId: string, newPassword: string): Promise<void> {
    const history = await this.prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: this.policy.historySize,
      select: { hash: true },
    });

    for (const entry of history) {
      if (await bcrypt.compare(newPassword, entry.hash)) {
        throw new BadRequestException(
          `A nova senha não pode ser igual a nenhuma das últimas ${this.policy.historySize} senhas utilizadas.`,
        );
      }
    }
  }

  /**
   * Registra a troca no histórico e apara para as últimas N entradas.
   * Na PRIMEIRA troca (histórico vazio) o hash ANTERIOR também entra — assim
   * a senha antiga do usuário já conta para o bloqueio de reuso.
   * Best-effort: falha aqui não pode desfazer uma troca de senha já gravada.
   */
  async recordPasswordChange(
    userId: string,
    previousHash: string | null,
    newHash: string,
  ): Promise<void> {
    try {
      if (previousHash) {
        const count = await this.prisma.passwordHistory.count({ where: { userId } });
        if (count === 0) {
          await this.prisma.passwordHistory.create({
            // createdAt 1s no passado: garante ordem estável (anterior < nova).
            data: { userId, hash: previousHash, createdAt: new Date(Date.now() - 1000) },
          });
        }
      }

      await this.prisma.passwordHistory.create({ data: { userId, hash: newHash } });

      // Apara: mantém só as últimas N entradas.
      const excess = await this.prisma.passwordHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: this.policy.historySize,
        select: { id: true },
      });
      if (excess.length > 0) {
        await this.prisma.passwordHistory.deleteMany({
          where: { id: { in: excess.map((e) => e.id) } },
        });
      }
    } catch (err) {
      this.logger.warn(
        `Falha ao registrar histórico de senha (best-effort): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Idade máxima da senha para o usuário: o MENOR passwordMaxAgeDays entre os
   * perfis ativos dele (mais restritivo vence). null = nenhum perfil exige
   * rotação (DEFAULT do sistema). Best-effort: erro de consulta → null (a
   * rotação nunca pode derrubar o login por indisponibilidade).
   */
  async getMaxAgeDays(userId: string): Promise<number | null> {
    try {
      const assignments = await this.prisma.userRoleAssignment.findMany({
        where: {
          userId,
          role: { isActive: true, passwordMaxAgeDays: { not: null } },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { role: { select: { passwordMaxAgeDays: true } } },
      });
      const ages = assignments
        .map((a) => a.role.passwordMaxAgeDays)
        .filter((v): v is number => typeof v === 'number' && v > 0);
      return ages.length > 0 ? Math.min(...ages) : null;
    } catch (err) {
      this.logger.warn(
        `Falha ao consultar passwordMaxAgeDays (best-effort, assume sem rotação): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Senha vencida? Só quando algum perfil do usuário define rotação.
   * Base do cálculo: passwordChangedAt; usuários antigos (null) usam
   * createdAt — a senha deles tem pelo menos a idade da conta.
   */
  async isPasswordExpired(user: {
    id: string;
    passwordChangedAt?: Date | null;
    createdAt?: Date | null;
  }): Promise<boolean> {
    const maxAgeDays = await this.getMaxAgeDays(user.id);
    if (maxAgeDays === null) return false;

    const base = user.passwordChangedAt ?? user.createdAt;
    if (!base) return false;

    const expiresAt = new Date(base.getTime() + maxAgeDays * 24 * 60 * 60 * 1000);
    return expiresAt < new Date();
  }
}
