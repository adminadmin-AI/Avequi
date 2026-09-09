/**
 * #1146 — troca de senha como UMA unidade atômica no Postgres.
 *
 * Aqui os serviços de histórico e de sessão são REAIS (PasswordPolicyService,
 * SessionService) e o Prisma é um fake em memória com semântica de transação:
 * `$transaction(cb)` roda o callback sobre um SNAPSHOT do estado; se o
 * callback lança, o snapshot é descartado (rollback) e o erro propaga; se
 * termina, o snapshot vira o estado (commit). Assim cada cenário prova o que
 * FICOU no banco, e não só quais mocks foram chamados.
 *
 * Redis (denylist) é mock e nunca participa da transação.
 */
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AuthService, PASSWORD_CHANGE_SCOPE } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSessionPolicy } from '../iam/access-session-policy.service';
import { AuditService } from '../iam/audit.service';
import { CompanyGroupService } from '../iam/company-group.service';
import { MfaService } from '../iam/mfa.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { SessionDenylistService } from '../iam/session-denylist.service';
import { SessionService } from '../iam/session.service';
import { TenantStatusService } from '../iam/tenant-status.service';

// ─── Fake Prisma em memória com commit/rollback ─────────────────────────────

interface Store {
  users: Record<string, any>;
  passwordHistory: any[];
  userSessions: Record<string, any>;
  refreshTokens: Record<string, any>;
  securityEvents: any[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v), reviveDates);
function reviveDates(_k: string, v: unknown) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
    ? new Date(v)
    : v;
}

/** Falhas injetáveis: chave "model.op" → erro lançado na N-ésima chamada. */
type FailAt = { key: string; call: number; error: Error };

function makeClient(store: Store, fails: FailAt[], counters: Record<string, number>) {
  const hit = (key: string) => {
    counters[key] = (counters[key] ?? 0) + 1;
    const f = fails.find((x) => x.key === key && x.call === counters[key]);
    if (f) throw f.error;
  };
  const matchWhere = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === 'object' && 'not' in (v as any)) return row[k] !== (v as any).not;
      if (v && typeof v === 'object' && 'in' in (v as any)) return (v as any).in.includes(row[k]);
      return row[k] === v;
    });

  return {
    user: {
      findUnique: async ({ where }: any) => {
        hit('user.findUnique');
        return store.users[where.id] ?? null;
      },
      update: async ({ where, data }: any) => {
        hit('user.update');
        store.users[where.id] = { ...store.users[where.id], ...data };
        return store.users[where.id];
      },
    },
    passwordHistory: {
      count: async ({ where }: any) => {
        hit('passwordHistory.count');
        return store.passwordHistory.filter((h) => matchWhere(h, where)).length;
      },
      create: async ({ data }: any) => {
        hit('passwordHistory.create');
        const row = { id: `ph-${store.passwordHistory.length + 1}`, createdAt: new Date(), ...data };
        store.passwordHistory.push(row);
        return row;
      },
      findMany: async ({ where, orderBy, take, skip }: any) => {
        hit('passwordHistory.findMany');
        let rows = store.passwordHistory.filter((h) => matchWhere(h, where));
        if (orderBy?.createdAt === 'desc') {
          rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (skip) rows = rows.slice(skip);
        if (take) rows = rows.slice(0, take);
        return rows;
      },
      deleteMany: async ({ where }: any) => {
        hit('passwordHistory.deleteMany');
        const before = store.passwordHistory.length;
        store.passwordHistory = store.passwordHistory.filter((h) => !matchWhere(h, where));
        return { count: before - store.passwordHistory.length };
      },
    },
    userSession: {
      findUnique: async ({ where }: any) => {
        hit('userSession.findUnique');
        return store.userSessions[where.id] ?? null;
      },
      findMany: async ({ where }: any) => {
        hit('userSession.findMany');
        return Object.values(store.userSessions).filter((s) => matchWhere(s, where));
      },
      update: async ({ where, data }: any) => {
        hit('userSession.update');
        store.userSessions[where.id] = { ...store.userSessions[where.id], ...data };
        return store.userSessions[where.id];
      },
      updateMany: async ({ where, data }: any) => {
        hit('userSession.updateMany');
        let count = 0;
        for (const s of Object.values(store.userSessions)) {
          if (matchWhere(s, where)) {
            Object.assign(s, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    refreshToken: {
      updateMany: async ({ where, data }: any) => {
        hit('refreshToken.updateMany');
        let count = 0;
        for (const r of Object.values(store.refreshTokens)) {
          if (matchWhere(r, where)) {
            Object.assign(r, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    securityEvent: {
      create: async ({ data }: any) => {
        hit('securityEvent.create');
        const row = { id: `ev-${store.securityEvents.length + 1}`, createdAt: new Date(), ...data };
        store.securityEvents.push(row);
        return row;
      },
    },
  };
}

function createFakePrisma(initial: Store) {
  const state = { store: clone(initial) };
  const fails: FailAt[] = [];
  const counters: Record<string, number> = {};
  const txMock = jest.fn(async (cb: (tx: any) => Promise<unknown>) => {
    const snapshot = clone(state.store);
    const tx = makeClient(snapshot, fails, counters);
    const result = await cb(tx); // lançou → snapshot descartado (rollback)
    state.store = snapshot; // terminou → commit
    return result;
  });
  // Proxy: o client raiz sempre aponta para o store COMMITADO atual.
  const live: any = new Proxy(
    {},
    {
      get(_t, prop: string | symbol) {
        if (prop === '$transaction') return txMock;
        if (typeof prop !== 'string') return undefined;
        const client = makeClient(state.store, fails, counters) as Record<string, unknown>;
        return client[prop];
      },
    },
  );
  return {
    prisma: live,
    fails,
    counters,
    get store(): Store {
      return state.store;
    },
  };
}

// ─── Cenário base ────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const COMPANY = 'company-1';
const OLD_HASH = '$2a$10$hash-antigo';

function baseStore(otherSessions: number, orphanRefreshTokens = 0): Store {
  const userSessions: Record<string, any> = {
    'sess-atual': { id: 'sess-atual', userId: USER_ID, companyId: COMPANY, refreshTokenId: 'rt-atual', revokedAt: null, revokedReason: null },
  };
  const refreshTokens: Record<string, any> = {
    'rt-atual': { id: 'rt-atual', userId: USER_ID, revokedAt: null },
  };
  for (let i = 1; i <= otherSessions; i += 1) {
    userSessions[`sess-${i}`] = { id: `sess-${i}`, userId: USER_ID, companyId: COMPANY, refreshTokenId: `rt-${i}`, revokedAt: null, revokedReason: null };
    refreshTokens[`rt-${i}`] = { id: `rt-${i}`, userId: USER_ID, revokedAt: null };
  }
  // Refresh ativo SEM UserSession (legado da transição M4 ou órfão da criação
  // best-effort da sessão no login) — não aparece em nenhuma enumeração de sessão.
  for (let i = 1; i <= orphanRefreshTokens; i += 1) {
    refreshTokens[`rt-orfao-${i}`] = { id: `rt-orfao-${i}`, userId: USER_ID, revokedAt: null };
  }
  // Refresh de OUTRO usuário: nunca pode ser tocado.
  refreshTokens['rt-outro-usuario'] = { id: 'rt-outro-usuario', userId: 'user-2', revokedAt: null };
  return {
    users: {
      [USER_ID]: {
        id: USER_ID,
        email: 'admin@exemplo.test',
        name: 'Admin',
        companyId: COMPANY,
        passwordHash: OLD_HASH,
        isActive: true,
        mustChangePassword: true,
        passwordChangedAt: null,
      },
    },
    passwordHistory: [],
    userSessions,
    refreshTokens,
    securityEvents: [],
  };
}

describe('AuthService.changePassword — unidade atômica no Postgres (#1146)', () => {
  let service: AuthService;
  let fake: ReturnType<typeof createFakePrisma>;
  const mockJwt = { sign: jest.fn(), verify: jest.fn() };
  const mockDenylist = { deny: jest.fn(), isSessionDenylisted: jest.fn() };
  const mockSessionsAlive = { isSessionAliveAndTouch: jest.fn() };
  let loggerError: jest.SpyInstance;

  async function build(store: Store) {
    fake = createFakePrisma(store);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordPolicyService,
        {
          provide: SessionService,
          useFactory: (prisma: PrismaService, denylist: SessionDenylistService) =>
            new SessionService(prisma, denylist),
          inject: [PrismaService, SessionDenylistService],
        },
        { provide: PrismaService, useValue: fake.prisma },
        { provide: SessionDenylistService, useValue: mockDenylist },
        { provide: JwtService, useValue: mockJwt },
        {
          provide: AccessSessionPolicy,
          useFactory: () => new AccessSessionPolicy(mockDenylist as any, mockSessionsAlive as any),
        },
        { provide: MfaService, useValue: {} },
        { provide: TenantStatusService, useValue: { getLoginBlock: jest.fn() } },
        {
          provide: CompanyGroupService,
          useValue: { empresasDoGrupo: jest.fn(), empresasDoUsuario: jest.fn(), podeAssumir: jest.fn(), raizDe: jest.fn() },
        },
        { provide: AuditService, useValue: { persist: jest.fn() } },
      ],
    }).compile();
    service = module.get(AuthService);
  }

  const voluntary = {
    accessToken: 'access-token-secreto-xyz',
    currentPassword: 'SenhaAtual#123',
    newPassword: 'NovaSenha#2026x',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('$2a$10$hash-novo' as never);
    mockJwt.verify.mockReturnValue({ sub: USER_ID, sessionId: 'sess-atual' });
    mockDenylist.isSessionDenylisted.mockResolvedValue(false);
    mockDenylist.deny.mockResolvedValue(true);
    mockSessionsAlive.isSessionAliveAndTouch.mockResolvedValue(true);
  });

  /** O que um rollback precisa deixar intacto. */
  function expectNothingPersisted(initial: Store) {
    const s = fake.store;
    expect(s.users[USER_ID].passwordHash).toBe(OLD_HASH);
    expect(s.users[USER_ID].mustChangePassword).toBe(initial.users[USER_ID].mustChangePassword);
    expect(s.users[USER_ID].passwordChangedAt).toBeNull();
    expect(s.passwordHistory).toEqual(initial.passwordHistory);
    for (const sess of Object.values(s.userSessions)) expect(sess.revokedAt).toBeNull();
    for (const rt of Object.values(s.refreshTokens)) expect(rt.revokedAt).toBeNull();
    expect(s.securityEvents).toEqual([]);
    expect(mockDenylist.deny).not.toHaveBeenCalled();
  }

  it('F. duas outras sessões → tudo commitado junto: senha, histórico, sessões, refresh, eventos com contagem real', async () => {
    await build(baseStore(2));

    const result = await service.changePassword(voluntary);

    expect(result).toEqual({ success: true, message: 'Senha alterada com sucesso.' });
    const s = fake.store;
    expect(s.users[USER_ID]).toMatchObject({
      passwordHash: '$2a$10$hash-novo',
      mustChangePassword: false,
      passwordChangedAt: expect.any(Date),
    });
    // Histórico: hash anterior (primeira troca) + novo.
    expect(s.passwordHistory.map((h) => h.hash)).toEqual([OLD_HASH, '$2a$10$hash-novo']);
    // Outras sessões revogadas por SECURITY, a corrente sobrevive.
    expect(s.userSessions['sess-1']).toMatchObject({ revokedAt: expect.any(Date), revokedReason: 'SECURITY' });
    expect(s.userSessions['sess-2']).toMatchObject({ revokedAt: expect.any(Date), revokedReason: 'SECURITY' });
    expect(s.userSessions['sess-atual'].revokedAt).toBeNull();
    // Refresh das revogadas morto; o da corrente vivo.
    expect(s.refreshTokens['rt-1'].revokedAt).toEqual(expect.any(Date));
    expect(s.refreshTokens['rt-2'].revokedAt).toEqual(expect.any(Date));
    expect(s.refreshTokens['rt-atual'].revokedAt).toBeNull();
    // Eventos: SESSION_REVOKED (count 2, CRITICAL) e PASSWORD_CHANGED fiel.
    expect(s.securityEvents).toHaveLength(2);
    expect(s.securityEvents[0]).toMatchObject({
      eventType: 'SESSION_REVOKED',
      severity: 'CRITICAL',
      userId: USER_ID,
      companyId: COMPANY,
      metadata: { count: 2, reason: 'SECURITY', global: true },
    });
    expect(s.securityEvents[1]).toMatchObject({
      eventType: 'PASSWORD_CHANGED',
      severity: 'INFO',
      userId: USER_ID,
      companyId: COMPANY,
      metadata: {
        restricted: false,
        otherSessionsRevoked: true,
        otherSessionsRevokedCount: 2,
        refreshTokensRevokedCount: 2,
      },
    });
    expect(s.securityEvents[1].metadata).not.toHaveProperty('denylistApplied');
    expect(s.refreshTokens['rt-outro-usuario'].revokedAt).toBeNull();
    // Uma única transação; Redis só depois, uma vez por sessão revogada.
    expect(fake.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDenylist.deny).toHaveBeenCalledTimes(2);
    expect(mockDenylist.deny).toHaveBeenCalledWith('sess-1');
    expect(mockDenylist.deny).toHaveBeenCalledWith('sess-2');
    expect(mockDenylist.deny).not.toHaveBeenCalledWith('sess-atual');
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('E. zero outras sessões → troca ok, revokedCount 0, otherSessionsRevoked false, SEM SESSION_REVOKED fictício', async () => {
    await build(baseStore(0));

    const result = await service.changePassword(voluntary);

    expect(result.success).toBe(true);
    const s = fake.store;
    expect(s.users[USER_ID].passwordHash).toBe('$2a$10$hash-novo');
    expect(s.userSessions['sess-atual'].revokedAt).toBeNull();
    expect(s.securityEvents).toHaveLength(1);
    expect(s.securityEvents[0]).toMatchObject({
      eventType: 'PASSWORD_CHANGED',
      metadata: {
        restricted: false,
        otherSessionsRevoked: false,
        otherSessionsRevokedCount: 0,
        refreshTokensRevokedCount: 0,
      },
    });
    expect(s.securityEvents.some((e) => e.eventType === 'SESSION_REVOKED')).toBe(false);
    expect(s.refreshTokens['rt-atual'].revokedAt).toBeNull();
    expect(mockDenylist.deny).not.toHaveBeenCalled();
  });

  it('A. histórico falha → rollback: senha antiga, histórico intacto, sessões intactas, zero eventos, erro ao usuário', async () => {
    const initial = baseStore(2);
    await build(initial);
    fake.fails.push({ key: 'passwordHistory.create', call: 1, error: new Error('db: history down') });

    await expect(service.changePassword(voluntary)).rejects.toThrow('db: history down');
    expectNothingPersisted(initial);
  });

  it('B. primeira revogação funciona, segunda falha → rollback também da primeira; zero estado parcial', async () => {
    const initial = baseStore(3);
    await build(initial);
    fake.fails.push({ key: 'userSession.update', call: 2, error: new Error('db: session down') });

    await expect(service.changePassword(voluntary)).rejects.toThrow('db: session down');
    // A primeira sessão foi marcada DENTRO da transação e voltou atrás.
    expect(fake.counters['userSession.update']).toBe(2);
    expectNothingPersisted(initial);
  });

  it('C. PASSWORD_CHANGED falha → rollback de senha + histórico + sessões + SESSION_REVOKED', async () => {
    const initial = baseStore(2);
    await build(initial);
    // 1ª chamada = SESSION_REVOKED (ok), 2ª = PASSWORD_CHANGED (falha).
    fake.fails.push({ key: 'securityEvent.create', call: 2, error: new Error('db: event down') });

    await expect(service.changePassword(voluntary)).rejects.toThrow('db: event down');
    expect(fake.counters['securityEvent.create']).toBe(2);
    expectNothingPersisted(initial);
  });

  it('D. SESSION_REVOKED falha → rollback de tudo (não existe "sessões revogadas mas auditoria falhou")', async () => {
    const initial = baseStore(2);
    await build(initial);
    fake.fails.push({ key: 'securityEvent.create', call: 1, error: new Error('db: audit down') });

    await expect(service.changePassword(voluntary)).rejects.toThrow('db: audit down');
    expectNothingPersisted(initial);
  });

  it('G. Redis indisponível pelo contrato REAL (deny resolve false, nunca lança) → banco commitado, sucesso, ERROR estruturado fiel', async () => {
    await build(baseStore(2));
    mockDenylist.deny.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const result = await service.changePassword(voluntary);

    expect(result.success).toBe(true);
    const s = fake.store;
    expect(s.users[USER_ID].passwordHash).toBe('$2a$10$hash-novo');
    expect(s.userSessions['sess-1'].revokedAt).toEqual(expect.any(Date));
    expect(s.userSessions['sess-2'].revokedAt).toEqual(expect.any(Date));
    expect(s.refreshTokens['rt-1'].revokedAt).toEqual(expect.any(Date));
    // Continuou tentando a segunda sessão.
    expect(mockDenylist.deny).toHaveBeenCalledTimes(2);
    // Telemetria persistida NÃO afirma nada sobre Redis; o log diz a verdade.
    const changed = s.securityEvents.find((e) => e.eventType === 'PASSWORD_CHANGED');
    expect(changed.metadata).toEqual({
      restricted: false,
      otherSessionsRevoked: true,
      otherSessionsRevokedCount: 2,
      refreshTokensRevokedCount: 2,
    });
    expect(loggerError).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(loggerError.mock.calls[0][0]);
    expect(logged).toMatchObject({
      event: 'password_change_denylist_failed',
      userId: USER_ID,
      sessionsRevoked: 2,
      denylistFailures: 1,
    });
    const raw = loggerError.mock.calls[0][0] as string;
    expect(raw).not.toContain('hash-novo');
    expect(raw).not.toContain('NovaSenha');
    expect(raw).not.toContain('secreto-xyz');
    expect(raw).not.toContain('SenhaAtual');
  });

  it('H. Redis funciona (deny true) → cada sessão revogada entra na denylist DEPOIS do commit (morte imediata preservada)', async () => {
    await build(baseStore(1));
    const order: string[] = [];
    mockDenylist.deny.mockImplementation(async () => {
      order.push('deny');
      return true;
    });
    (fake.prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      order.push('tx-start');
      const snapshot = clone(fake.store);
      const r = await cb(makeClient(snapshot, fake.fails, fake.counters));
      order.push('tx-commit');
      return r;
    });

    await service.changePassword(voluntary);

    expect(order).toEqual(['tx-start', 'tx-commit', 'deny']);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('modo RESTRITO (token de troca obrigatória, sem sessionId) → revoga TODAS as sessões existentes, mustChangePassword=false', async () => {
    await build(baseStore(1));
    mockJwt.verify.mockReturnValue({ sub: USER_ID, scope: PASSWORD_CHANGE_SCOPE });

    const result = await service.changePassword({
      passwordChangeToken: 'restrito',
      newPassword: 'NovaSenha#2026x',
    });

    expect(result.success).toBe(true);
    const s = fake.store;
    expect(s.users[USER_ID].mustChangePassword).toBe(false);
    expect(s.userSessions['sess-atual'].revokedAt).toEqual(expect.any(Date));
    expect(s.userSessions['sess-1'].revokedAt).toEqual(expect.any(Date));
    const changed = s.securityEvents.find((e) => e.eventType === 'PASSWORD_CHANGED');
    expect(changed.metadata).toEqual({
      restricted: true,
      otherSessionsRevoked: true,
      otherSessionsRevokedCount: 2,
      refreshTokensRevokedCount: 2,
    });
    expect(s.refreshTokens['rt-atual'].revokedAt).toEqual(expect.any(Date));
    expect(s.refreshTokens['rt-1'].revokedAt).toEqual(expect.any(Date));
    expect(mockDenylist.deny).toHaveBeenCalledTimes(2);
  });

  it('anti-replay do token restrito (iat < passwordChangedAt) → 401 antes de abrir transação', async () => {
    const initial = baseStore(1);
    initial.users[USER_ID].passwordChangedAt = new Date('2026-09-01T12:00:00.000Z');
    await build(initial);
    mockJwt.verify.mockReturnValue({
      sub: USER_ID,
      scope: PASSWORD_CHANGE_SCOPE,
      iat: Math.floor(new Date('2026-09-01T11:59:00.000Z').getTime() / 1000),
    });

    await expect(
      service.changePassword({ passwordChangeToken: 'replay', newPassword: 'NovaSenha#2026x' }),
    ).rejects.toThrow('Token de troca de senha inválido ou expirado');
    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
    expect(fake.store.users[USER_ID].passwordHash).toBe(OLD_HASH);
  });

  it('senha atual errada no modo normal → 401 sem abrir transação', async () => {
    await build(baseStore(1));
    (bcrypt.compare as unknown as jest.Mock).mockResolvedValue(false);

    await expect(service.changePassword(voluntary)).rejects.toThrow('Senha atual incorreta.');
    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reuso das últimas 5 → BadRequest antes da transação (assertNotReused é real e lê o histórico)', async () => {
    const initial = baseStore(0);
    initial.passwordHistory = [{ id: 'ph-0', userId: USER_ID, hash: '$2a$10$reusada', createdAt: new Date() }];
    await build(initial);
    // compare(senhaAtual, hashAtual)=true; compare(nova, hash do histórico)=true → reuso.
    (bcrypt.compare as unknown as jest.Mock).mockResolvedValue(true);

    await expect(service.changePassword(voluntary)).rejects.toThrow(
      'não pode ser igual a nenhuma das últimas',
    );
    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('bcrypt.hash roda FORA da transação (antes de abri-la)', async () => {
    await build(baseStore(0));
    const order: string[] = [];
    (bcrypt.hash as unknown as jest.Mock).mockImplementation(async () => {
      order.push('hash');
      return '$2a$10$hash-novo';
    });
    const original = fake.prisma.$transaction.getMockImplementation()!;
    (fake.prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      order.push('tx');
      return original(cb);
    });

    await service.changePassword(voluntary);
    expect(order).toEqual(['hash', 'tx']);
  });

  // ─── Rodada 2 (auditoria Codex): refresh tokens sem UserSession, fail-closed, rollbacks extras ──

  it('R2-A. refresh ÓRFÃO ativo + modo restrito → órfão revogado junto com tudo; contagens separadas e fiéis', async () => {
    await build(baseStore(1, 2));
    mockJwt.verify.mockReturnValue({ sub: USER_ID, scope: PASSWORD_CHANGE_SCOPE });

    const result = await service.changePassword({ passwordChangeToken: 'restrito', newPassword: 'NovaSenha#2026x' });

    expect(result.success).toBe(true);
    const s = fake.store;
    for (const id of ['rt-atual', 'rt-1', 'rt-orfao-1', 'rt-orfao-2']) {
      expect(s.refreshTokens[id].revokedAt).toEqual(expect.any(Date));
    }
    expect(s.refreshTokens['rt-outro-usuario'].revokedAt).toBeNull();
    const changed = s.securityEvents.find((e) => e.eventType === 'PASSWORD_CHANGED');
    expect(changed.metadata).toEqual({
      restricted: true,
      otherSessionsRevoked: true,
      otherSessionsRevokedCount: 2, // sessões REAIS (sess-atual + sess-1)
      refreshTokensRevokedCount: 4, // 2 vinculados + 2 órfãos
    });
    const revokedEv = s.securityEvents.find((e) => e.eventType === 'SESSION_REVOKED');
    expect(revokedEv.metadata).toEqual({ count: 2, reason: 'SECURITY', global: true }); // órfão nunca vira sessão
  });

  it('R2-B. refresh ÓRFÃO ativo + modo normal com sessão corrente → órfão revogado, refresh da corrente preservado (provado pelo ID persistido)', async () => {
    await build(baseStore(0, 1));

    const result = await service.changePassword(voluntary);

    expect(result.success).toBe(true);
    const s = fake.store;
    expect(s.refreshTokens['rt-orfao-1'].revokedAt).toEqual(expect.any(Date));
    expect(s.refreshTokens['rt-atual'].revokedAt).toBeNull();
    expect(s.userSessions['sess-atual'].revokedAt).toBeNull();
    expect(fake.counters['userSession.findUnique']).toBe(1); // corrente localizada pelo id
    const changed = s.securityEvents.find((e) => e.eventType === 'PASSWORD_CHANGED');
    expect(changed.metadata).toEqual({
      restricted: false,
      otherSessionsRevoked: false,
      otherSessionsRevokedCount: 0,
      refreshTokensRevokedCount: 1,
    });
    expect(s.securityEvents.some((e) => e.eventType === 'SESSION_REVOKED')).toBe(false);
    expect(mockDenylist.deny).not.toHaveBeenCalled(); // sem sessão revogada, nada a denylistar
  });

  it('R2-C. duas outras sessões + refresh órfão → todas as outras sessões e todos os refresh exceto o corrente revogados; contagens fiéis', async () => {
    await build(baseStore(2, 1));

    await service.changePassword(voluntary);

    const s = fake.store;
    expect(s.userSessions['sess-1'].revokedReason).toBe('SECURITY');
    expect(s.userSessions['sess-2'].revokedReason).toBe('SECURITY');
    expect(s.userSessions['sess-atual'].revokedAt).toBeNull();
    for (const id of ['rt-1', 'rt-2', 'rt-orfao-1']) expect(s.refreshTokens[id].revokedAt).toEqual(expect.any(Date));
    expect(s.refreshTokens['rt-atual'].revokedAt).toBeNull();
    expect(s.refreshTokens['rt-outro-usuario'].revokedAt).toBeNull();
    const changed = s.securityEvents.find((e) => e.eventType === 'PASSWORD_CHANGED');
    expect(changed.metadata).toEqual({
      restricted: false,
      otherSessionsRevoked: true,
      otherSessionsRevokedCount: 2,
      refreshTokensRevokedCount: 3,
    });
    expect(s.securityEvents.find((e) => e.eventType === 'SESSION_REVOKED').metadata.count).toBe(2);
    expect(mockDenylist.deny).toHaveBeenCalledTimes(2);
  });

  it('R2-D. modo normal com access token SEM sessionId → 401 genérico antes da transação; nada persiste', async () => {
    const initial = baseStore(1, 1);
    await build(initial);
    mockJwt.verify.mockReturnValue({ sub: USER_ID }); // token legado, sem sessionId

    await expect(service.changePassword(voluntary)).rejects.toThrow(
      'Sessão inválida ou expirada. Faça login novamente.',
    );
    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
    expect(fake.counters['user.update']).toBeUndefined();
    expectNothingPersisted(initial);
  });

  it('R2-D2. sessão corrente do token não existe mais no banco → 401 dentro da transação e rollback total', async () => {
    const initial = baseStore(1, 1);
    await build(initial);
    mockJwt.verify.mockReturnValue({ sub: USER_ID, sessionId: 'sess-fantasma' });

    await expect(service.changePassword(voluntary)).rejects.toThrow(
      'Sessão inválida ou expirada. Faça login novamente.',
    );
    expect(fake.prisma.$transaction).toHaveBeenCalledTimes(1);
    expectNothingPersisted(initial);
  });

  it('R2-E. falha ao revogar RefreshToken → rollback completo (nenhum refresh parcialmente revogado)', async () => {
    const initial = baseStore(2, 1);
    await build(initial);
    fake.fails.push({ key: 'refreshToken.updateMany', call: 1, error: new Error('db: refresh down') });

    await expect(service.changePassword(voluntary)).rejects.toThrow('db: refresh down');
    expectNothingPersisted(initial);
  });

  it('R2-F. falha em user.update → zero efeitos', async () => {
    const initial = baseStore(1, 1);
    await build(initial);
    fake.fails.push({ key: 'user.update', call: 1, error: new Error('db: user down') });

    await expect(service.changePassword(voluntary)).rejects.toThrow('db: user down');
    expectNothingPersisted(initial);
  });

  it('R2-G1. falha no SEGUNDO passwordHistory.create (hash novo) → rollback completo', async () => {
    const initial = baseStore(1);
    await build(initial);
    fake.fails.push({ key: 'passwordHistory.create', call: 2, error: new Error('db: history#2 down') });

    await expect(service.changePassword(voluntary)).rejects.toThrow('db: history#2 down');
    expect(fake.counters['passwordHistory.create']).toBe(2);
    expectNothingPersisted(initial);
  });

  it('R2-G2. falha no pruning do histórico → rollback completo', async () => {
    const initial = baseStore(1);
    // 5 entradas antigas: a nova excede o histórico e força o deleteMany.
    initial.passwordHistory = Array.from({ length: 5 }, (_, i) => ({
      id: `ph-old-${i}`,
      userId: USER_ID,
      hash: `$2a$10$old-${i}`,
      createdAt: new Date(Date.now() - (10 - i) * 1000),
    }));
    await build(initial);
    (bcrypt.compare as unknown as jest.Mock).mockImplementation(
      async (_plain: string, hash: string) => hash === OLD_HASH, // senha atual confere; nenhuma do histórico é reuso
    );
    fake.fails.push({ key: 'passwordHistory.deleteMany', call: 1, error: new Error('db: prune down') });

    await expect(service.changePassword(voluntary)).rejects.toThrow('db: prune down');
    expect(fake.counters['passwordHistory.deleteMany']).toBe(1);
    expectNothingPersisted(initial);
  });

  it('R2-H. Redis indisponível pelo contrato real em TODAS as sessões → banco commitado, sucesso, log com denylistFailures igual ao total', async () => {
    await build(baseStore(2));
    mockDenylist.deny.mockResolvedValue(false);

    const result = await service.changePassword(voluntary);

    expect(result.success).toBe(true);
    expect(fake.store.userSessions['sess-1'].revokedAt).toEqual(expect.any(Date));
    expect(fake.store.userSessions['sess-2'].revokedAt).toEqual(expect.any(Date));
    expect(fake.store.users[USER_ID].passwordHash).toBe('$2a$10$hash-novo');
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(JSON.parse(loggerError.mock.calls[0][0])).toMatchObject({
      event: 'password_change_denylist_failed',
      sessionsRevoked: 2,
      denylistFailures: 2,
    });
  });

  it('R2-I. Redis funcionando (deny true em todas) → nenhum log de falha, comportamento atual preservado', async () => {
    await build(baseStore(2));
    mockDenylist.deny.mockResolvedValue(true);

    await service.changePassword(voluntary);

    expect(mockDenylist.deny).toHaveBeenCalledTimes(2);
    expect(loggerError).not.toHaveBeenCalled();
  });
});
