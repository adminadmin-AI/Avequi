import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from './session.service';
import {
  derivarEnumLegado,
  LegacyRoleMirrorService,
  type AssignmentParaDerivacao,
} from './legacy-role-mirror.service';

/**
 * #946 — espelho do papel legado. A derivação é função PURA: os cenários
 * abaixo são a especificação executável da decisão do Rafael (03/08/2026).
 */

const oficial = (code: string): AssignmentParaDerivacao['role'] => ({
  code,
  isActive: true,
  companyId: null, // perfil de plataforma
});

const a = (
  roleId: string,
  role: AssignmentParaDerivacao['role'],
  expiresAt: Date | null = null,
): AssignmentParaDerivacao => ({ roleId, expiresAt, role });

describe('derivarEnumLegado (#946)', () => {
  it('DIRETOR apenas → DIRECTOR', () => {
    const r = derivarEnumLegado([a('r1', oficial('DIRETOR'))]);
    expect(r.enum).toBe('DIRECTOR');
    expect(r.motivo).toBeUndefined();
    expect(r.perfis).toEqual(['DIRETOR']);
  });

  it('o MESMO perfil em duas filiais continua sendo UM papel → DIRECTOR', () => {
    // #347-B: escopo por filial cria um assignment por filial. Sem o dedup por
    // roleId, todo gerente multi-loja cairia em "ambíguo" indevidamente.
    const r = derivarEnumLegado([a('r1', oficial('DIRETOR')), a('r1', oficial('DIRETOR'))]);
    expect(r.enum).toBe('DIRECTOR');
    expect(r.perfis).toEqual(['DIRETOR']);
  });

  it('DIRETOR + VENDEDOR → congela (AMBIGUOUS_MULTIPLE_ROLES)', () => {
    const r = derivarEnumLegado([a('r1', oficial('DIRETOR')), a('r2', oficial('VENDEDOR'))]);
    expect(r.enum).toBeNull();
    expect(r.motivo).toBe('AMBIGUOUS_MULTIPLE_ROLES');
    expect(r.perfis).toEqual(['DIRETOR', 'VENDEDOR']);
  });

  it('ADMIN_EMPRESA apenas → congela (NO_ENUM_EQUIVALENT)', () => {
    const r = derivarEnumLegado([a('r1', oficial('ADMIN_EMPRESA'))]);
    expect(r.enum).toBeNull();
    expect(r.motivo).toBe('NO_ENUM_EQUIVALENT');
  });

  it('perfil customizado apenas → congela (CUSTOM_ROLE)', () => {
    const r = derivarEnumLegado([
      a('r1', { code: 'COMPRADOR_JUNIOR', isActive: true, companyId: 'co-1' }),
    ]);
    expect(r.enum).toBeNull();
    expect(r.motivo).toBe('CUSTOM_ROLE');
  });

  it('DIRETOR + customizado → congela (AMBIGUOUS_MULTIPLE_ROLES)', () => {
    const r = derivarEnumLegado([
      a('r1', oficial('DIRETOR')),
      a('r2', { code: 'COMPRADOR_JUNIOR', isActive: true, companyId: 'co-1' }),
    ]);
    expect(r.enum).toBeNull();
    expect(r.motivo).toBe('AMBIGUOUS_MULTIPLE_ROLES');
  });

  it('nenhum perfil ativo → congela (NO_ACTIVE_ROLE)', () => {
    const r = derivarEnumLegado([]);
    expect(r.enum).toBeNull();
    expect(r.motivo).toBe('NO_ACTIVE_ROLE');
    expect(r.perfis).toEqual([]);
  });

  it('role INATIVA não conta', () => {
    const r = derivarEnumLegado([a('r1', { ...oficial('DIRETOR'), isActive: false })]);
    expect(r.motivo).toBe('NO_ACTIVE_ROLE');
  });

  it('assignment EXPIRADO não conta; o válido decide', () => {
    const ontem = new Date(Date.now() - 86_400_000);
    const amanha = new Date(Date.now() + 86_400_000);
    const r = derivarEnumLegado([
      a('r1', oficial('DIRETOR'), ontem), // expirado
      a('r2', oficial('VENDEDOR'), amanha), // válido
    ]);
    expect(r.enum).toBe('COMMERCIAL');
    expect(r.perfis).toEqual(['VENDEDOR']);
  });

  it('NUNCA escolhe o "mais poderoso" nem força READER em caso ambíguo', () => {
    const r = derivarEnumLegado([
      a('r1', oficial('ADMIN_GLOBAL')),
      a('r2', oficial('SOMENTE_LEITURA')),
    ]);
    expect(r.enum).toBeNull(); // nem SUPER_ADMIN, nem READER
  });
});

describe('LegacyRoleMirrorService (#946)', () => {
  const mockTx = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    userRoleAssignment: { findMany: jest.fn() },
  } as any;

  const mockSessions = { revokeAllSessions: jest.fn() };
  let service: LegacyRoleMirrorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegacyRoleMirrorService,
        { provide: PrismaService, useValue: {} },
        { provide: SessionService, useValue: mockSessions },
      ],
    }).compile();
    service = module.get(LegacyRoleMirrorService);
    jest.clearAllMocks();
    mockTx.user.findUnique.mockResolvedValue({ role: 'READER' });
    mockSessions.revokeAllSessions.mockResolvedValue(2);
  });

  it('derivação: atualiza o enum na MESMA transação e devolve antes/depois', async () => {
    mockTx.userRoleAssignment.findMany.mockResolvedValue([a('r1', oficial('DIRETOR'))]);

    const r = await service.sincronizarNaTransacao(mockTx, 'u1');

    expect(r).toMatchObject({
      status: 'DERIVED',
      enumAnterior: 'READER',
      enumResultante: 'DIRECTOR',
      perfis: ['DIRETOR'],
    });
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'DIRECTOR' },
    });
  });

  it('congelamento: NÃO toca no enum e devolve o motivo', async () => {
    mockTx.userRoleAssignment.findMany.mockResolvedValue([
      a('r1', oficial('DIRETOR')),
      a('r2', oficial('VENDEDOR')),
    ]);

    const r = await service.sincronizarNaTransacao(mockTx, 'u1');

    expect(r.status).toBe('FROZEN');
    expect(r.motivo).toBe('AMBIGUOUS_MULTIPLE_ROLES');
    expect(r.enumAnterior).toBe('READER');
    expect(r.enumResultante).toBe('READER');
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  it('enum derivado IGUAL ao atual: não grava nada (evita update inútil)', async () => {
    mockTx.user.findUnique.mockResolvedValue({ role: 'DIRECTOR' });
    mockTx.userRoleAssignment.findMany.mockResolvedValue([a('r1', oficial('DIRETOR'))]);

    const r = await service.sincronizarNaTransacao(mockTx, 'u1');

    expect(r.status).toBe('DERIVED');
    expect(r.enumResultante).toBe('DIRECTOR');
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  describe('revogação de sessões', () => {
    it('enum MUDOU → revoga todas as sessões (ADMIN_REVOKE) e conta', async () => {
      const n = await service.revogarSessoesSeMudou(
        {
          status: 'DERIVED',
          enumAnterior: 'DIRECTOR',
          enumResultante: 'COMMERCIAL',
          perfis: ['VENDEDOR'],
          sessoesRevogadas: 0,
        },
        'u1',
      );
      expect(n).toBe(2);
      expect(mockSessions.revokeAllSessions).toHaveBeenCalledWith('u1', 'ADMIN_REVOKE');
    });

    it('enum INALTERADO → não revoga', async () => {
      const n = await service.revogarSessoesSeMudou(
        {
          status: 'DERIVED',
          enumAnterior: 'DIRECTOR',
          enumResultante: 'DIRECTOR',
          perfis: ['DIRETOR'],
          sessoesRevogadas: 0,
        },
        'u1',
      );
      expect(n).toBe(0);
      expect(mockSessions.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('CONGELADO → não revoga (congelar não derruba ninguém)', async () => {
      const n = await service.revogarSessoesSeMudou(
        {
          status: 'FROZEN',
          motivo: 'AMBIGUOUS_MULTIPLE_ROLES',
          enumAnterior: 'DIRECTOR',
          enumResultante: 'DIRECTOR',
          perfis: ['DIRETOR', 'VENDEDOR'],
          sessoesRevogadas: 0,
        },
        'u1',
      );
      expect(n).toBe(0);
      expect(mockSessions.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('falha ao revogar é registrada e NÃO desfaz a operação (best-effort)', async () => {
      mockSessions.revokeAllSessions.mockRejectedValue(new Error('redis fora'));
      const n = await service.revogarSessoesSeMudou(
        {
          status: 'DERIVED',
          enumAnterior: 'DIRECTOR',
          enumResultante: 'COMMERCIAL',
          perfis: ['VENDEDOR'],
          sessoesRevogadas: 0,
        },
        'u1',
      );
      expect(n).toBe(0); // não lança: risco residual = vida do access token
    });
  });
});
