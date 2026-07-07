import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordPolicyService } from './password-policy.service';

const mockPrisma = {
  passwordHistory: {
    findMany: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  userRoleAssignment: {
    findMany: jest.fn(),
  },
};

/** Extrai o array de mensagens do BadRequestException do Nest. */
function messagesOf(err: unknown): string[] {
  const response = (err as BadRequestException).getResponse() as any;
  return Array.isArray(response.message) ? response.message : [response.message];
}

describe('PasswordPolicyService (#345)', () => {
  let service: PasswordPolicyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordPolicyService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(PasswordPolicyService);
    jest.clearAllMocks();
    mockPrisma.passwordHistory.findMany.mockResolvedValue([]);
    mockPrisma.passwordHistory.create.mockResolvedValue({});
    mockPrisma.passwordHistory.count.mockResolvedValue(0);
    mockPrisma.passwordHistory.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([]);
  });

  // ─── Complexidade ──────────────────────────────────────────────────────────

  describe('validateComplexity', () => {
    it('aceita senha forte que cumpre todas as regras', () => {
      expect(() => service.validateComplexity('Xk9#mQ2$wZ7p')).not.toThrow();
    });

    it('rejeita senha com menos de 10 caracteres com mensagem PT-BR', () => {
      try {
        service.validateComplexity('Ab1#xyz');
        fail('deveria lançar');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect(messagesOf(err)).toContain('A senha deve ter no mínimo 10 caracteres.');
      }
    });

    it('rejeita senha com mais de 128 caracteres', () => {
      const longa = 'Ab1#' + 'x'.repeat(130);
      try {
        service.validateComplexity(longa);
        fail('deveria lançar');
      } catch (err) {
        expect(messagesOf(err)).toContain('A senha deve ter no máximo 128 caracteres.');
      }
    });

    it('rejeita senha sem maiúscula listando exatamente o que faltou', () => {
      try {
        service.validateComplexity('semmaiuscula1#');
        fail('deveria lançar');
      } catch (err) {
        const msgs = messagesOf(err);
        expect(msgs).toContain('A senha deve conter pelo menos uma letra maiúscula (A-Z).');
        expect(msgs).toHaveLength(1); // só a regra que falhou
      }
    });

    it('rejeita senha sem minúscula', () => {
      try {
        service.validateComplexity('SEMMINUSCULA1#');
        fail('deveria lançar');
      } catch (err) {
        expect(messagesOf(err)).toContain(
          'A senha deve conter pelo menos uma letra minúscula (a-z).',
        );
      }
    });

    it('rejeita senha sem número', () => {
      try {
        service.validateComplexity('SemNumeroAqui#');
        fail('deveria lançar');
      } catch (err) {
        expect(messagesOf(err)).toContain('A senha deve conter pelo menos um número (0-9).');
      }
    });

    it('rejeita senha sem caractere especial', () => {
      try {
        service.validateComplexity('SemEspecial123');
        fail('deveria lançar');
      } catch (err) {
        expect(messagesOf(err)).toContain(
          'A senha deve conter pelo menos um caractere especial (ex.: !@#$%&*).',
        );
      }
    });

    it('acumula TODAS as regras violadas em uma única resposta', () => {
      try {
        service.validateComplexity('abc'); // curta, sem maiúscula, número ok? não tem; sem especial
        fail('deveria lançar');
      } catch (err) {
        const msgs = messagesOf(err);
        expect(msgs.length).toBeGreaterThanOrEqual(4); // mínimo + maiúscula + número + especial
      }
    });

    it.each(['senha123', 'Senha123', 'SENHA123', 'gdr2026', 'password123', 'p@ssw0rd'])(
      'rejeita senha comum "%s" (case-insensitive) mesmo junto com outras violações',
      (comum) => {
        try {
          service.validateComplexity(comum);
          fail('deveria lançar');
        } catch (err) {
          expect(messagesOf(err)).toContain(
            'Esta senha é muito comum e fácil de adivinhar. Escolha outra.',
          );
        }
      },
    );

    it('rejeita senha que contém o e-mail do usuário (parte local)', () => {
      try {
        service.validateComplexity('Joao.silva#2026X', {
          email: 'joao.silva@gdr.com.br',
          name: 'Outro Nome',
        });
        fail('deveria lançar');
      } catch (err) {
        expect(messagesOf(err)).toContain('A senha não pode conter o seu nome ou o seu e-mail.');
      }
    });

    it('rejeita senha que contém parte do nome do usuário', () => {
      try {
        service.validateComplexity('Rafael#2026ok9', {
          email: 'outro@gdr.com.br',
          name: 'Rafael Avequi',
        });
        fail('deveria lançar');
      } catch (err) {
        expect(messagesOf(err)).toContain('A senha não pode conter o seu nome ou o seu e-mail.');
      }
    });

    it('aceita senha forte que NÃO contém nome nem e-mail', () => {
      expect(() =>
        service.validateComplexity('Xk9#mQ2$wZ7p', {
          email: 'joao@gdr.com.br',
          name: 'João Silva',
        }),
      ).not.toThrow();
    });
  });

  // ─── Histórico: bloqueio de reuso ──────────────────────────────────────────

  describe('assertNotReused', () => {
    const hashOf = (pwd: string) => bcrypt.hashSync(pwd, 4);

    it('rejeita reuso de qualquer uma das últimas 5 senhas', async () => {
      const antigas = ['Antiga#001aa', 'Antiga#002aa', 'Antiga#003aa', 'Antiga#004aa', 'Antiga#005aa'];
      mockPrisma.passwordHistory.findMany.mockResolvedValue(
        antigas.map((p) => ({ hash: hashOf(p) })),
      );

      await expect(service.assertNotReused('user-1', 'Antiga#003aa')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.assertNotReused('user-1', 'Antiga#003aa')).rejects.toThrow(
        /últimas 5 senhas/,
      );
    });

    it('aceita a 6ª senha antiga (fora da janela das últimas 5)', async () => {
      // O take: 5 do Prisma já corta a 6ª — o mock devolve só as 5 mais recentes.
      const recentes = ['Nova#0001aa', 'Nova#0002aa', 'Nova#0003aa', 'Nova#0004aa', 'Nova#0005aa'];
      mockPrisma.passwordHistory.findMany.mockResolvedValue(
        recentes.map((p) => ({ hash: hashOf(p) })),
      );

      await expect(service.assertNotReused('user-1', 'Sexta#0006aa')).resolves.toBeUndefined();
      expect(mockPrisma.passwordHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, orderBy: { createdAt: 'desc' } }),
      );
    });

    it('aceita qualquer senha quando o histórico está vazio', async () => {
      mockPrisma.passwordHistory.findMany.mockResolvedValue([]);
      await expect(service.assertNotReused('user-1', 'Qualquer#123X')).resolves.toBeUndefined();
    });
  });

  // ─── Histórico: registro das trocas ────────────────────────────────────────

  describe('recordPasswordChange', () => {
    it('na PRIMEIRA troca insere também o hash anterior (senha atual entra no histórico)', async () => {
      mockPrisma.passwordHistory.count.mockResolvedValue(0);

      await service.recordPasswordChange('user-1', 'hash-anterior', 'hash-novo');

      const creates = mockPrisma.passwordHistory.create.mock.calls.map((c) => c[0].data);
      expect(creates).toHaveLength(2);
      expect(creates[0].hash).toBe('hash-anterior');
      expect(creates[1].hash).toBe('hash-novo');
    });

    it('em trocas seguintes insere só o hash novo (anterior já está no histórico)', async () => {
      mockPrisma.passwordHistory.count.mockResolvedValue(3);

      await service.recordPasswordChange('user-1', 'hash-anterior', 'hash-novo');

      const creates = mockPrisma.passwordHistory.create.mock.calls.map((c) => c[0].data);
      expect(creates).toHaveLength(1);
      expect(creates[0].hash).toBe('hash-novo');
    });

    it('apara o histórico para as últimas 5 entradas', async () => {
      mockPrisma.passwordHistory.count.mockResolvedValue(5);
      mockPrisma.passwordHistory.findMany.mockResolvedValue([{ id: 'velho-1' }]);

      await service.recordPasswordChange('user-1', null, 'hash-novo');

      expect(mockPrisma.passwordHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5 }),
      );
      expect(mockPrisma.passwordHistory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['velho-1'] } },
      });
    });

    it('é best-effort: erro de banco não propaga', async () => {
      mockPrisma.passwordHistory.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.recordPasswordChange('user-1', null, 'hash-novo'),
      ).resolves.toBeUndefined();
    });
  });

  // ─── Rotação ───────────────────────────────────────────────────────────────

  describe('rotação (getMaxAgeDays / isPasswordExpired)', () => {
    it('sem perfil com passwordMaxAgeDays → null (rotação DESLIGADA por default)', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([]);
      await expect(service.getMaxAgeDays('user-1')).resolves.toBeNull();
    });

    it('com múltiplos perfis, o MENOR passwordMaxAgeDays vence (mais restritivo)', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { role: { passwordMaxAgeDays: 90 } },
        { role: { passwordMaxAgeDays: 30 } },
      ]);
      await expect(service.getMaxAgeDays('user-1')).resolves.toBe(30);
    });

    it('senha NÃO vence quando nenhum perfil define rotação', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([]);
      const veterano = {
        id: 'user-1',
        passwordChangedAt: new Date('2020-01-01'),
        createdAt: new Date('2019-01-01'),
      };
      await expect(service.isPasswordExpired(veterano)).resolves.toBe(false);
    });

    it('senha vence quando passou de passwordMaxAgeDays', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { role: { passwordMaxAgeDays: 90 } },
      ]);
      const antiga = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
      await expect(
        service.isPasswordExpired({ id: 'user-1', passwordChangedAt: antiga, createdAt: antiga }),
      ).resolves.toBe(true);
    });

    it('senha recém-trocada NÃO vence', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { role: { passwordMaxAgeDays: 90 } },
      ]);
      await expect(
        service.isPasswordExpired({
          id: 'user-1',
          passwordChangedAt: new Date(),
          createdAt: new Date('2020-01-01'),
        }),
      ).resolves.toBe(false);
    });

    it('usuário legado (passwordChangedAt null) usa createdAt como base', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { role: { passwordMaxAgeDays: 90 } },
      ]);
      await expect(
        service.isPasswordExpired({
          id: 'user-1',
          passwordChangedAt: null,
          createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        }),
      ).resolves.toBe(true);
    });

    it('é best-effort: erro na consulta de perfis → não expira (login nunca cai)', async () => {
      mockPrisma.userRoleAssignment.findMany.mockRejectedValue(new Error('db down'));
      await expect(
        service.isPasswordExpired({ id: 'user-1', passwordChangedAt: new Date('2020-01-01') }),
      ).resolves.toBe(false);
    });
  });

  // ─── Política pública ──────────────────────────────────────────────────────

  it('getPolicy expõe as regras vigentes (GET /auth/password-policy)', () => {
    const policy = service.getPolicy();
    expect(policy.minLength).toBe(10);
    expect(policy.historySize).toBe(5);
    expect(policy.requireUppercase).toBe(true);
    expect(policy.description).toContain('10 caracteres');
  });
});
