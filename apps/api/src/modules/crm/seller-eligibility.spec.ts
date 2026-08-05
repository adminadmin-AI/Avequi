import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../iam/permission.service';
import { SellerEligibilityService, NO_ELIGIBLE_SELLER } from './seller-eligibility.service';
import { SYSTEM_ROLES, resolveEffectivePermissions } from '../iam/roles.catalog';

/**
 * #1002-C3 — a fonte única de elegibilidade e a matriz aprovada.
 */
describe('SellerEligibilityService (#1002-C3)', () => {
  let service: SellerEligibilityService;

  const COMPANY = 'c1';
  const mockPrisma = { user: { findMany: jest.fn() } };
  const mockPermissions = { usersWithPermission: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerEligibilityService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PermissionService, useValue: mockPermissions },
      ],
    }).compile();
    service = module.get(SellerEligibilityService);
    jest.clearAllMocks();
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPermissions.usersWithPermission.mockResolvedValue(['u1', 'u2']);
  });

  describe('candidatos para ATRIBUIÇÃO', () => {
    it('parte de quem tem a permissão — não de uma lista de enums', async () => {
      await service.candidatosParaAtribuicao(COMPANY);

      expect(mockPermissions.usersWithPermission).toHaveBeenCalledWith(
        COMPANY,
        'crm.leads.assignable',
      );
    });

    it('exige ativo, disponível, destravado e da mesma empresa', async () => {
      await service.candidatosParaAtribuicao(COMPANY);

      const where = mockPrisma.user.findMany.mock.calls[0][0].where;
      expect(where.companyId).toBe(COMPANY);
      expect(where.isActive).toBe(true);
      expect(where.crmAvailable).toBe(true);
      // lockedUntil nulo OU já expirado — conta travada não recebe lead
      expect(where.OR).toEqual([
        { lockedUntil: null },
        { lockedUntil: { lte: expect.any(Date) } },
      ]);
      expect(where.id.in).toEqual(['u1', 'u2']);
    });

    it('excludeUserId é repassado ao filtro', async () => {
      await service.candidatosParaAtribuicao(COMPANY, 'u1');

      expect(mockPrisma.user.findMany.mock.calls[0][0].where.id).toEqual({
        in: ['u1', 'u2'],
        not: 'u1',
      });
    });

    it('sem ninguém com a permissão: devolve vazio sem consultar usuários', async () => {
      mockPermissions.usersWithPermission.mockResolvedValue([]);

      await expect(service.candidatosParaAtribuicao(COMPANY)).resolves.toEqual([]);
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });

    it('não usa TenantScope: o recorte é a Company do lead, nunca o grupo', async () => {
      // Lead de filial não pode cair em vendedor da matriz.
      await service.candidatosParaAtribuicao(COMPANY);

      const where = mockPrisma.user.findMany.mock.calls[0][0].where;
      expect(where.companyId).toBe(COMPANY);
      expect(Object.keys(where)).not.toContain('company');
    });
  });

  describe('candidatos para CONFIGURAÇÃO', () => {
    it('mesma classe da atribuição — a tela não promete o que o rodízio não cumpre', async () => {
      await service.candidatosParaConfiguracao(COMPANY);

      expect(mockPermissions.usersWithPermission).toHaveBeenCalledWith(
        COMPANY,
        'crm.leads.assignable',
      );
    });

    it('NÃO filtra crmAvailable — é nesta tela que ele é editado', async () => {
      await service.candidatosParaConfiguracao(COMPANY);

      const where = mockPrisma.user.findMany.mock.calls[0][0].where;
      expect(where.crmAvailable).toBeUndefined();
      expect(where.isActive).toBe(true);
      expect(where.companyId).toBe(COMPANY);
    });

    it('devolve o estado atual de crmAvailable para a tela mostrar', async () => {
      await service.candidatosParaConfiguracao(COMPANY);

      expect(mockPrisma.user.findMany.mock.calls[0][0].select).toEqual({
        id: true,
        name: true,
        crmAvailable: true,
      });
    });
  });

  describe('log de captação sem destino', () => {
    it('registra motivo estruturado, sem dado de cliente', () => {
      const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

      service.registrarSemElegivel(COMPANY, 'lead-intake.pickNextSeller', 0);

      const payload = JSON.parse(warn.mock.calls[0][0] as string);
      expect(payload).toEqual({
        event: 'crm_lead_unassigned',
        reason: NO_ELIGIBLE_SELLER,
        companyId: COMPANY,
        origem: 'lead-intake.pickNextSeller',
        avaliados: 0,
      });
      // nada de telefone, nome ou id de lead
      expect(JSON.stringify(payload)).not.toMatch(/phone|nome|leadId/i);
    });
  });
});

describe('#1002-C3 — matriz de crm.leads.assignable', () => {
  const CODE = 'crm.leads.assignable';

  const quemTem = () =>
    (SYSTEM_ROLES as { code: string }[])
      .filter((r) => resolveEffectivePermissions(r.code).includes(CODE))
      .map((r) => r.code)
      .sort();

  it('exatamente os perfis aprovados, incluindo LOJA_FATURAMENTO por herança', () => {
    // LOJA_FATURAMENTO não estava na lista aprovada, mas está no MEIO da cadeia
    // LOJA_OPERACIONAL → LOJA_FATURAMENTO → GERENTE_LOJA, e os dois extremos
    // foram aprovados. Excluí-lo exigiria um deny explícito no meio da herança
    // — e seria incoerente: é um atendente de loja que também fatura.
    expect(quemTem()).toEqual(
      [
        'COORDENADOR_COMERCIAL',
        'GERENTE_COMERCIAL',
        'GERENTE_LOJA',
        'LOJA_FATURAMENTO',
        'LOJA_OPERACIONAL',
        'VENDEDOR',
      ].sort(),
    );
  });

  it('ADMIN_GLOBAL e ADMIN_EMPRESA NÃO recebem por varredura dinâmica', () => {
    // Elegibilidade para receber lead é função operacional, não privilégio.
    // Sem a exclusão, o dono da empresa entraria no rodízio de balcão.
    for (const code of ['ADMIN_GLOBAL', 'ADMIN_EMPRESA']) {
      expect({ [code]: resolveEffectivePermissions(code).includes(CODE) }).toEqual({
        [code]: false,
      });
    }
  });

  it('DIRETOR e GERENTE_GERAL não recebem por varredura de crm.*', () => {
    // Os dois usam moduleCodes('crm'), que traria a permissão nova sozinha.
    for (const code of ['DIRETOR', 'GERENTE_GERAL']) {
      const perms = resolveEffectivePermissions(code);
      expect({ [code]: perms.includes(CODE) }).toEqual({ [code]: false });
      expect(perms).toContain('crm.leads.view'); // o resto do CRM continua
    }
  });

  it('perfis sem função de atendimento não recebem', () => {
    for (const code of [
      'ADMIN_FILIAL',
      'GERENTE_INDUSTRIAL',
      'FINANCEIRO',
      'GERENTE_FINANCEIRO',
      'COMPRADOR',
      'ALMOXARIFE',
      'AUDITOR',
      'SOMENTE_LEITURA',
    ]) {
      expect({ [code]: resolveEffectivePermissions(code).includes(CODE) }).toEqual({
        [code]: false,
      });
    }
  });
});

describe('#1002-C3 — consistência: nenhuma lista de enums voltou', () => {
  const semComentarios = (p: string) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('fs')
      .readFileSync(p, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('os três consumidores não filtram mais por User.role', () => {
    // Guarda contra a divergência voltar: eram três listas, em três arquivos,
    // e elas não batiam entre si.
    for (const arquivo of [
      'src/modules/crm/lead-intake.service.ts',
      'src/modules/crm/sdr/sdr-tools.ts',
      'src/modules/crm/crm-settings.service.ts',
    ]) {
      const src = semComentarios(arquivo);
      expect({ [arquivo]: /role:\s*\{\s*in:/.test(src) }).toEqual({ [arquivo]: false });
      expect({ [arquivo]: /COMMERCIAL|SELLER_ROLES/.test(src) }).toEqual({ [arquivo]: false });
    }
  });

  it('a elegibilidade tem uma fonte só', () => {
    // Se alguém criar uma segunda consulta de elegibilidade, ela não vai
    // passar por aqui — e este teste é o lembrete de onde ela deve morar.
    const fonte = semComentarios('src/modules/crm/seller-eligibility.service.ts');
    expect(fonte).toMatch(/usersWithPermission/);
    expect(fonte).toMatch(/crmAvailable/);
    expect(fonte).toMatch(/lockedUntil/);
  });
});
