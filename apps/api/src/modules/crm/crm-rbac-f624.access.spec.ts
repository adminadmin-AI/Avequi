import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { moduleCodes } from '../iam/permissions.catalog';
import { SYSTEM_ROLES, resolveEffectivePermissions } from '../iam/roles.catalog';
import { CrmController } from './crm.controller';
import { WhatsappController } from './whatsapp/whatsapp.controller';
import { ConnectorsController } from './connectors/connectors.controller';

/**
 * Bloco F (#624) — acesso EFETIVO da família crm.* (decisões D1–D7 do Rafael,
 * 13/07/2026; de-acordo técnico do Claudinho na issue).
 *
 * Duas frentes, ambas contra o código REAL (catálogo + metadata dos
 * controllers + PermissionGuard):
 *
 * 1. MATRIZ perfil × permissão para TODOS os perfis system do catálogo (28),
 *    um a um — nada de coluna agregada "demais". A tabela EXPECTED abaixo é
 *    escrita à mão: perfil novo no catálogo QUEBRA este spec até ser
 *    declarado aqui (decisão consciente, não herança acidental).
 *
 * 2. Guard de verdade nas rotas: paridade VENDEDOR × LOJA_OPERACIONAL,
 *    bloqueios cirúrgicos (LGPD, massa, exports, settings) e o mecanismo de
 *    concessão avulsa (perfil customizado / grant individual).
 */

const CRM_ALL = moduleCodes('crm').sort();

const OPERACIONAL = [
  'crm.leads.view',
  'crm.conversations.view',
  'crm.leads.create',
  'crm.leads.move',
  'crm.leads.convert',
  'crm.leads.annotate',
  'crm.messages.send',
  'crm.templates.send',
  'crm.proposals.send',
  'crm.sdr.takeover',
  'crm.connectors.answer',
  'crm.quick-replies.manage',
].sort();

const GERENCIAL_SEM_LGPD = [
  'crm.leads.list',
  'crm.leads.export',
  'crm.leads.reassign',
  'crm.leads.bulk-reassign',
  'crm.leads.bulk-stage',
  'crm.distribution.view',
  'crm.dashboard.view',
  'crm.dashboard.export',
  'crm.portfolio.view', // #846 — leitura gerencial da carteira de clientes
  'crm.settings.view',
  'crm.settings.update',
  'crm.templates.sync',
  'crm.sdr.monitor',
  'crm.sdr.operate',
  'crm.quick-replies.manage-all',
  'crm.reminders.manage-all',
].sort();

const SEM_LGPD = [...OPERACIONAL, ...GERENCIAL_SEM_LGPD].sort(); // 28/30

/** Matriz aprovada — cada um dos 28 perfis system, DECLARADO NOMINALMENTE. */
const EXPECTED: Record<string, string[]> = {
  ADMIN_GLOBAL: CRM_ALL,
  ADMIN_EMPRESA: CRM_ALL,
  ADMIN_FILIAL: SEM_LGPD, // D7 (Opção C): lista explícita, sem as 2 LGPD
  DIRETOR: CRM_ALL,
  GERENTE_GERAL: CRM_ALL, // espelho do MANAGER legado — zero regressão
  GERENTE_INDUSTRIAL: [],
  GERENTE_FINANCEIRO: [],
  GERENTE_COMERCIAL: SEM_LGPD,
  GERENTE_COMPRAS: [],
  SUPERVISOR_PRODUCAO: [],
  SUPERVISOR_ESTOQUE: [],
  COORDENADOR_COMERCIAL: [
    ...OPERACIONAL, // herda VENDEDOR
    'crm.leads.list',
    'crm.dashboard.view',
    'crm.distribution.view',
    'crm.sdr.monitor',
    'crm.leads.reassign', // D6: SÓ a individual
  ].sort(),
  COMPRADOR: [],
  VENDEDOR: OPERACIONAL,
  OPERADOR_PCP: [],
  OPERADOR_PRODUCAO: [],
  ALMOXARIFE: [],
  FINANCEIRO: [],
  FISCAL: [],
  RH: [],
  QUALIDADE: [],
  ASSISTENCIA_TECNICA: [],
  AUDITOR: ['crm.conversations.view', 'crm.leads.view'], // D4: leitura pura
  SOMENTE_LEITURA: ['crm.leads.view'], // D4: funil sim, conversas NÃO
  VISITANTE: [],
  LOJA_OPERACIONAL: OPERACIONAL, // D3: paridade com VENDEDOR
  LOJA_FATURAMENTO: OPERACIONAL, // herança de LOJA_OPERACIONAL
  GERENTE_LOJA: SEM_LGPD, // herança operacional + gerencial explícita
};

function crmOf(roleCode: string): string[] {
  return resolveEffectivePermissions(roleCode)
    .filter((c) => c.startsWith('crm.'))
    .sort();
}

describe('Bloco F (#624) — matriz crm.* perfil a perfil', () => {
  it('a família tem exatamente 30 códigos', () => {
    expect(CRM_ALL).toHaveLength(30);
  });

  it('pacotes fecham com as decisões: 12 operacionais, 16 gerenciais s/ LGPD, 28 = 30 - 2', () => {
    expect(OPERACIONAL).toHaveLength(12);
    expect(GERENCIAL_SEM_LGPD).toHaveLength(16);
    expect(SEM_LGPD).toHaveLength(28);
    const lgpd = CRM_ALL.filter((c) => !SEM_LGPD.includes(c));
    expect(lgpd.sort()).toEqual(['crm.lgpd.anonymize', 'crm.lgpd.retention-update']);
  });

  it('TODO perfil do catálogo está declarado na tabela (guarda de crescimento)', () => {
    const naoDeclarados = SYSTEM_ROLES.map((r) => r.code).filter((c) => !(c in EXPECTED));
    expect(naoDeclarados).toEqual([]);
    const fantasmas = Object.keys(EXPECTED).filter(
      (c) => !SYSTEM_ROLES.some((r) => r.code === c),
    );
    expect(fantasmas).toEqual([]);
    expect(SYSTEM_ROLES).toHaveLength(28);
  });

  it.each(SYSTEM_ROLES.map((r) => [r.code] as [string]))(
    '%s recebe exatamente o pacote aprovado (herança resolvida)',
    (code) => {
      expect(crmOf(code)).toEqual(EXPECTED[code]);
    },
  );

  it('crm.lgpd.* é EXCLUSIVA de GERENTE_GERAL, DIRETOR, ADMIN_EMPRESA e ADMIN_GLOBAL (D5)', () => {
    const donos = SYSTEM_ROLES.map((r) => r.code)
      .filter((c) =>
        ['crm.lgpd.anonymize', 'crm.lgpd.retention-update'].every((p) =>
          crmOf(c).includes(p),
        ),
      )
      .sort();
    expect(donos).toEqual(['ADMIN_EMPRESA', 'ADMIN_GLOBAL', 'DIRETOR', 'GERENTE_GERAL']);
    // e ninguém tem só uma das duas
    for (const role of SYSTEM_ROLES) {
      const tem = crmOf(role.code).filter((c) => c.startsWith('crm.lgpd.'));
      expect([0, 2]).toContain(tem.length);
    }
  });

  it('paridade D3: VENDEDOR e LOJA_OPERACIONAL têm pacotes crm IDÊNTICOS', () => {
    expect(crmOf('VENDEDOR')).toEqual(crmOf('LOJA_OPERACIONAL'));
  });
});

// ── Guard de verdade nas rotas reais ─────────────────────────────────────────

const reflector = new Reflector();

interface Endpoint {
  name: string;
  handler: (...args: unknown[]) => unknown;
  required?: string[];
  isPublic?: boolean;
}

function methodsOf(ControllerClass: new (...args: any[]) => any): Endpoint[] {
  const proto = ControllerClass.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter(
      (m) =>
        m !== 'constructor' &&
        typeof proto[m] === 'function' &&
        // só ROTAS de verdade (metadata 'path' do @Get/@Post/...) — helpers
        // privados do controller (actor, listFilters etc.) ficam de fora
        Reflect.getMetadata('path', proto[m]) !== undefined,
    )
    .map((m) => ({
      name: m,
      handler: proto[m],
      required: reflector.get<string[]>(REQUIRE_PERMISSION_KEY, proto[m]),
      isPublic: reflector.get<boolean>(IS_PUBLIC_KEY, proto[m]),
    }));
}

function ctxFor(
  ControllerClass: new (...args: any[]) => any,
  handler: Endpoint['handler'],
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ControllerClass,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', companyId: 'c1' } }),
    }),
  } as unknown as ExecutionContext;
}

/** Exercita o PermissionGuard real com um conjunto efetivo arbitrário. */
async function allows(
  ControllerClass: new (...args: any[]) => any,
  handlerName: string,
  permissions: string[],
): Promise<boolean> {
  const endpoint = methodsOf(ControllerClass).find((e) => e.name === handlerName);
  if (!endpoint) throw new Error(`handler '${handlerName}' não existe`);
  const guard = new PermissionGuard(reflector, {
    getUserPermissions: jest.fn().mockResolvedValue({ roles: [], permissions }),
  } as any);
  try {
    return await guard.canActivate(ctxFor(ControllerClass, endpoint.handler));
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

const asProfile = (code: string) => resolveEffectivePermissions(code);

describe('Bloco F (#624) — cobertura de gate dos controllers do CRM', () => {
  it('51 rotas autenticadas gateadas com UMA permissão crm.* do catálogo; @Public sem gate', () => {
    const gated: string[] = [];
    for (const Ctrl of [CrmController, WhatsappController, ConnectorsController]) {
      for (const e of methodsOf(Ctrl)) {
        if (e.isPublic) {
          expect(e.required ?? []).toEqual([]); // pública jamais carrega gate
          continue;
        }
        expect(e.required).toHaveLength(1);
        expect(e.required![0].startsWith('crm.')).toBe(true);
        expect(CRM_ALL).toContain(e.required![0]);
        gated.push(`${Ctrl.name}.${e.name}`);
      }
    }
    expect(gated).toHaveLength(51); // 46 crm (+portfolio #846) + 4 whatsapp + 1 connectors
  });

  it('explicitações do Claudinho: proposal-options sob proposals.send; sdr.operate SÓ no revert', () => {
    const byName = Object.fromEntries(methodsOf(CrmController).map((e) => [e.name, e.required]));
    expect(byName['proposalOptions']).toEqual(['crm.proposals.send']);
    expect(byName['sendProposal']).toEqual(['crm.proposals.send']);
    const operateRoutes = methodsOf(CrmController).filter(
      (e) => e.required?.[0] === 'crm.sdr.operate',
    );
    expect(operateRoutes.map((e) => e.name)).toEqual(['sdrRevertDiscard']);
    // settings.view/update cobrem também as rotas /settings/sellers
    expect(byName['getSellers']).toEqual(['crm.settings.view']);
    expect(byName['setSellerAvailability']).toEqual(['crm.settings.update']);
  });

  it('paridade D3 no guard: VENDEDOR e LOJA_OPERACIONAL passam nas MESMAS rotas', async () => {
    for (const e of methodsOf(CrmController)) {
      if (e.isPublic || !e.required) continue;
      const vendedor = await allows(CrmController, e.name, asProfile('VENDEDOR'));
      const loja = await allows(CrmController, e.name, asProfile('LOJA_OPERACIONAL'));
      expect(`${e.name}:${loja}`).toBe(`${e.name}:${vendedor}`);
    }
  });

  it('COORDENADOR_COMERCIAL: reatribuição individual SIM; massa/exports/settings/sdr.operate/LGPD NÃO', async () => {
    const coord = asProfile('COORDENADOR_COMERCIAL');
    expect(await allows(CrmController, 'reassign', coord)).toBe(true);
    expect(await allows(CrmController, 'leadsList', coord)).toBe(true);
    for (const blocked of [
      'bulkReassign',
      'bulkStage',
      'leadsCsv',
      'dashboardCsv',
      'getSettings',
      'updateSettings',
      'setSellerAvailability',
      'templatesSync',
      'sdrRevertDiscard',
      'anonymize',
    ]) {
      expect(`${blocked}:${await allows(CrmController, blocked, coord)}`).toBe(
        `${blocked}:false`,
      );
    }
  });

  it('GERENTE_LOJA / GERENTE_COMERCIAL / ADMIN_FILIAL: gerencial completo, LGPD bloqueada', async () => {
    for (const profile of ['GERENTE_LOJA', 'GERENTE_COMERCIAL', 'ADMIN_FILIAL']) {
      const perms = asProfile(profile);
      expect(await allows(CrmController, 'bulkReassign', perms)).toBe(true);
      expect(await allows(CrmController, 'updateSettings', perms)).toBe(true);
      expect(await allows(CrmController, 'anonymize', perms)).toBe(false);
    }
  });

  it('quatro perfis LGPD anonimizam; GERENTE_GERAL preserva o MANAGER legado', async () => {
    for (const profile of ['GERENTE_GERAL', 'DIRETOR', 'ADMIN_EMPRESA', 'ADMIN_GLOBAL']) {
      expect(await allows(CrmController, 'anonymize', asProfile(profile))).toBe(true);
    }
  });

  it('AUDITOR: leituras 200, TODA escrita 403', async () => {
    const auditor = asProfile('AUDITOR');
    expect(await allows(CrmController, 'board', auditor)).toBe(true);
    expect(await allows(CrmController, 'conversations', auditor)).toBe(true);
    expect(await allows(WhatsappController, 'list', auditor)).toBe(true); // GET
    for (const e of methodsOf(CrmController)) {
      if (e.isPublic || !e.required) continue;
      const isRead =
        e.required[0] === 'crm.leads.view' || e.required[0] === 'crm.conversations.view';
      if (!isRead) {
        expect(`${e.name}:${await allows(CrmController, e.name, auditor)}`).toBe(
          `${e.name}:false`,
        );
      }
    }
    expect(await allows(WhatsappController, 'send', auditor)).toBe(false);
  });

  it('SOMENTE_LEITURA: funil 200, conversas 403 (D4)', async () => {
    const reader = asProfile('SOMENTE_LEITURA');
    expect(await allows(CrmController, 'board', reader)).toBe(true);
    expect(await allows(CrmController, 'lead', reader)).toBe(true);
    expect(await allows(CrmController, 'conversations', reader)).toBe(false);
    expect(await allows(WhatsappController, 'list', reader)).toBe(false);
    expect(await allows(WhatsappController, 'media', reader)).toBe(false);
  });

  it('perfis não comerciais: 403 nas DUAS superfícies de leitura (retirada deliberada D4)', async () => {
    for (const profile of [
      'GERENTE_INDUSTRIAL',
      'GERENTE_FINANCEIRO',
      'GERENTE_COMPRAS',
      'SUPERVISOR_PRODUCAO',
      'SUPERVISOR_ESTOQUE',
      'COMPRADOR',
      'OPERADOR_PCP',
      'OPERADOR_PRODUCAO',
      'ALMOXARIFE',
      'FINANCEIRO',
      'FISCAL',
      'RH',
      'QUALIDADE',
      'ASSISTENCIA_TECNICA',
      'VISITANTE',
    ]) {
      const perms = asProfile(profile);
      expect(`${profile}:${await allows(CrmController, 'board', perms)}`).toBe(
        `${profile}:false`,
      );
      expect(`${profile}:${await allows(CrmController, 'conversations', perms)}`).toBe(
        `${profile}:false`,
      );
    }
  });

  it('mecanismo de concessão avulsa (perfil customizado / grant individual) funciona', async () => {
    // um conjunto efetivo qualquer com o code certo passa; sem ele, 403 —
    // independe de perfil system (é assim que perfis custom entram no guard).
    expect(await allows(CrmController, 'reassign', ['crm.leads.reassign'])).toBe(true);
    expect(await allows(CrmController, 'reassign', ['crm.leads.bulk-reassign'])).toBe(false);
    expect(await allows(CrmController, 'anonymize', ['crm.lgpd.anonymize'])).toBe(true);
  });
});
