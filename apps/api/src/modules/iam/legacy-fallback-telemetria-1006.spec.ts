import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { PermissionCacheService } from './permission-cache.service';
import { PermissionService } from './permission.service';
import { ENUM_ROLE_TO_SYSTEM_ROLE, resolveEffectivePermissions } from './roles.catalog';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Telemetria do fallback legado — Fase D, etapa D1 (#1006).
 *
 * O que estes testes protegem: o evento `iam_legacy_fallback_used` é a ÚNICA
 * evidência comportamental de que alguém ainda depende do enum `User.role`.
 * O portão do D2 (remover o fallback) exige uma semana operacional com ZERO
 * eventos destes — se a emissão quebrar em silêncio, a janela mede nada e o
 * fallback cairia às cegas.
 *
 * Convenção do repo: Prisma e cache mockados, nunca banco real.
 */

const mockPrisma = {
  userRoleAssignment: { findMany: jest.fn() },
  userPermission: { findMany: jest.fn() },
  role: { findMany: jest.fn() },
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delUserAllCompanies: jest.fn(),
  delCompany: jest.fn(),
};

/** Eventos de telemetria emitidos, já desempacotados do JSON. */
function eventosEmitidos(spy: jest.SpyInstance): any[] {
  return spy.mock.calls
    .map(([msg]) => msg)
    .filter((msg): msg is string => typeof msg === 'string')
    .map((msg) => {
      try {
        return JSON.parse(msg);
      } catch {
        return null;
      }
    })
    .filter((obj) => obj?.event === 'iam_legacy_fallback_used');
}

describe('Telemetria do fallback legado (#1006 D1)', () => {
  let service: PermissionService;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Usuário SEM nada no RBAC v2 — a condição que aciona o fallback.
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([]);
    mockPrisma.userPermission.findMany.mockResolvedValue([]);
    mockPrisma.role.findMany.mockResolvedValue([]);
    mockCache.get.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PermissionCacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<PermissionService>(PermissionService);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('emite o evento quando o fallback REALMENTE concede o perfil-espelho', async () => {
    const { legacyFallback } = await service.resolveWithLegacyFallback(
      'u1',
      'c1',
      'FINANCIAL',
      'route_guard',
    );

    expect(legacyFallback).toBe(true);
    expect(eventosEmitidos(warn)).toHaveLength(1);
  });

  it('o evento carrega os campos esperados (usuário, empresa, papel legado, espelho)', async () => {
    await service.resolveWithLegacyFallback('u-42', 'empresa-7', 'MANAGER', 'route_guard');

    const [evento] = eventosEmitidos(warn);
    expect(evento).toEqual({
      event: 'iam_legacy_fallback_used',
      userId: 'u-42',
      companyId: 'empresa-7',
      legacyRole: 'MANAGER',
      // o espelho REALMENTE concedido, não o que se supõe
      mirrorCode: ENUM_ROLE_TO_SYSTEM_ROLE.MANAGER,
      origem: 'route_guard',
    });
  });

  it('identifica a origem: guard de rota', async () => {
    await service.resolveWithLegacyFallback('u1', 'c1', 'READER', 'route_guard');
    expect(eventosEmitidos(warn)[0].origem).toBe('route_guard');
  });

  it('identifica a origem: /auth/me/permissions (default do getMyEffectivePermissions)', async () => {
    await service.getMyEffectivePermissions('u1', 'c1', 'READER');
    expect(eventosEmitidos(warn)[0].origem).toBe('auth_me_permissions');
  });

  it('sem origem declarada o evento sai como "desconhecida" — nunca sai sem evento', async () => {
    await service.resolveWithLegacyFallback('u1', 'c1', 'READER');
    expect(eventosEmitidos(warn)[0].origem).toBe('desconhecida');
  });

  it('NÃO emite quando a resolução acontece normalmente pelo RBAC v2', async () => {
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
      { roleId: 'r1', role: { code: 'FINANCEIRO' } },
    ]);
    mockPrisma.role.findMany.mockResolvedValue([
      {
        id: 'r1',
        parentId: null,
        rolePermissions: [{ granted: true, permission: { code: 'finance.entries.view' } }],
      },
    ]);

    const { legacyFallback } = await service.resolveWithLegacyFallback(
      'u1',
      'c1',
      'FINANCIAL',
      'route_guard',
    );

    expect(legacyFallback).toBe(false);
    expect(eventosEmitidos(warn)).toHaveLength(0);
  });

  it('NÃO emite quando o enum é desconhecido (fail-closed, sem espelho concedido)', async () => {
    const { legacyFallback } = await service.resolveWithLegacyFallback(
      'u1',
      'c1',
      'PAPEL_QUE_NAO_EXISTE',
      'route_guard',
    );

    expect(legacyFallback).toBe(false);
    expect(eventosEmitidos(warn)).toHaveLength(0);
  });

  it('falha na emissão do log NÃO altera o resultado da autorização', async () => {
    warn.mockImplementation(() => {
      throw new Error('coletor de logs fora do ar');
    });

    const resultado = await service.resolveWithLegacyFallback(
      'u1',
      'c1',
      'FINANCIAL',
      'route_guard',
    );

    // Idêntico ao que sairia sem telemetria nenhuma.
    expect(resultado.legacyFallback).toBe(true);
    expect(resultado.resolved.roles).toEqual([ENUM_ROLE_TO_SYSTEM_ROLE.FINANCIAL]);
    expect(resultado.resolved.permissions).toEqual(
      [...resolveEffectivePermissions(ENUM_ROLE_TO_SYSTEM_ROLE.FINANCIAL)].sort(),
    );
  });

  it('continuam existindo APENAS os dois pontos de entrada permitidos do fallback', () => {
    // Trava de código (#947/#1001 usam a mesma técnica, por arquivo). Aqui a
    // varredura é do src INTEIRO: se alguém criar um terceiro chamador, o
    // fallback volta a decidir acesso num caminho que ninguém está medindo.
    const arquivos: string[] = [];
    const varrer = (dir: string) => {
      for (const entrada of readdirSync(dir)) {
        const caminho = join(dir, entrada);
        if (statSync(caminho).isDirectory()) varrer(caminho);
        else if (entrada.endsWith('.ts') && !entrada.endsWith('.spec.ts')) arquivos.push(caminho);
      }
    };
    expect(existsSync('src')).toBe(true);
    varrer('src');

    const chamadores = arquivos.filter((caminho) =>
      readFileSync(caminho, 'utf-8')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
        .some((l) => l.includes('resolveWithLegacyFallback(')),
    );

    expect(chamadores.map((c) => c.replace(/\\/g, '/')).sort()).toEqual([
      // o guard de rota (enforcement) …
      'src/common/guards/permission.guard.ts',
      // … e a própria definição + o getMyEffectivePermissions, que serve o menu
      'src/modules/iam/permission.service.ts',
    ]);
  });
});
