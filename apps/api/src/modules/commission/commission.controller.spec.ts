import { CommissionController } from './commission.controller';
import { CommissionService } from './commission.service';
import { PermissionService } from '../iam/permission.service';

/**
 * Privacidade de comissões (decisão Rafael 04/07/2026, migrada para RBAC v2
 * na #1001-C2).
 *
 * Antes o recorte era por enum: `user.role === 'COMMERCIAL'` forçava o filtro
 * para o próprio usuário. Isso restringia UM perfil só — qualquer outro papel,
 * inclusive gerentes sem responsabilidade comercial nenhuma, via a comissão e
 * o PERCENTUAL de todos os vendedores.
 *
 * Agora quem manda é `sales.commissions.view-all`, resolvida no RBAC v2 puro.
 * Os testes abaixo falam em "com permissão" / "sem permissão", não em papéis:
 * o enum não participa mais da decisão.
 */
describe('CommissionController — visão ampla depende de permissão (#1001-C2)', () => {
  let controller: CommissionController;
  let service: jest.Mocked<CommissionService>;
  let permissions: { hasAnyPermission: jest.Mock };

  const COMPANY = 'company-1';
  /** Vendedor: tem `view`, não tem `view-all`. */
  const SELLER = { id: 'seller-1', role: 'COMMERCIAL', companyId: COMPANY };
  /** Gestor: tem `view-all`. */
  const GESTOR = { id: 'mgr-1', role: 'MANAGER', companyId: COMPANY };

  /** Concede/nega `view-all` — é o único eixo de decisão agora. */
  const comViewAll = (pode: boolean) =>
    permissions.hasAnyPermission.mockResolvedValue(pode);

  beforeEach(() => {
    service = {
      findAll: jest.fn().mockResolvedValue([]),
      findRules: jest.fn().mockResolvedValue([]),
      approveBatch: jest.fn(),
      createRule: jest.fn(),
    } as unknown as jest.Mocked<CommissionService>;

    permissions = { hasAnyPermission: jest.fn().mockResolvedValue(false) };

    controller = new CommissionController(
      service,
      permissions as unknown as PermissionService,
    );
  });

  describe('GET /commissions (findAll)', () => {
    it('SEM view-all e sem filtro: força userId = usuário logado', async () => {
      comViewAll(false);
      await controller.findAll(SELLER);

      expect(service.findAll).toHaveBeenCalledWith(COMPANY, {
        userId: SELLER.id,
        status: undefined,
        from: undefined,
        to: undefined,
      });
    });

    it('SEM view-all tentando ?userId= de outro: o filtro é IGNORADO', async () => {
      // Ignorado, não rejeitado: recusar com erro daria ao cliente um oráculo
      // para descobrir quais usuários existem.
      comViewAll(false);
      await controller.findAll(SELLER, 'outro-vendedor');

      expect(service.findAll).toHaveBeenCalledWith(
        COMPANY,
        expect.objectContaining({ userId: SELLER.id }),
      );
    });

    it('SEM view-all mantém os demais filtros (status/from/to)', async () => {
      comViewAll(false);
      await controller.findAll(SELLER, 'outro-vendedor', 'PENDING', '2026-01-01', '2026-12-31');

      expect(service.findAll).toHaveBeenCalledWith(COMPANY, {
        userId: SELLER.id,
        status: 'PENDING',
        from: '2026-01-01',
        to: '2026-12-31',
      });
    });

    it('COM view-all: o userId da query é respeitado', async () => {
      comViewAll(true);
      await controller.findAll(GESTOR, 'seller-1');

      expect(service.findAll).toHaveBeenCalledWith(
        COMPANY,
        expect.objectContaining({ userId: 'seller-1' }),
      );
    });

    it('COM view-all e sem filtro: lista todas as comissões da empresa', async () => {
      comViewAll(true);
      await controller.findAll(GESTOR);

      expect(service.findAll).toHaveBeenCalledWith(
        COMPANY,
        expect.objectContaining({ userId: undefined }),
      );
    });

    it('a permissão é resolvida para o usuário e a empresa do JWT', async () => {
      comViewAll(true);
      await controller.findAll(GESTOR);

      expect(permissions.hasAnyPermission).toHaveBeenCalledWith(GESTOR.id, COMPANY, [
        'sales.commissions.view-all',
      ]);
    });

    it('o ENUM não concede: papel gerencial sem a permissão vê só as próprias', async () => {
      // A prova de que o enum saiu da decisão. Antes, MANAGER via tudo.
      comViewAll(false);
      await controller.findAll(GESTOR, 'seller-1');

      expect(service.findAll).toHaveBeenCalledWith(
        COMPANY,
        expect.objectContaining({ userId: GESTOR.id }),
      );
    });

    it('o escopo de empresa vem do JWT e não é ampliado por view-all', async () => {
      comViewAll(true);
      await controller.findAll({ ...GESTOR, companyId: 'outra-empresa' });

      // `view-all` amplia de "só eu" para "todos DESTA empresa" — nunca para
      // outras. O companyId continua sendo o único recorte de tenant.
      expect(service.findAll).toHaveBeenCalledWith('outra-empresa', expect.anything());
    });

    it('falha na resolução da permissão PROPAGA — não vira visão ampla', async () => {
      // Negar por erro de infraestrutura é o lado seguro em dado de remuneração.
      permissions.hasAnyPermission.mockRejectedValue(new Error('redis fora'));

      await expect(controller.findAll(GESTOR)).rejects.toThrow('redis fora');
      expect(service.findAll).not.toHaveBeenCalled();
    });
  });

  describe('GET /commissions/rules (findRules) — percentuais', () => {
    it('SEM view-all: só a própria regra', async () => {
      comViewAll(false);
      await controller.findRules(SELLER);

      expect(service.findRules).toHaveBeenCalledWith(COMPANY, SELLER.id);
    });

    it('COM view-all: todas as regras da empresa', async () => {
      comViewAll(true);
      await controller.findRules(GESTOR);

      expect(service.findRules).toHaveBeenCalledWith(COMPANY, undefined);
    });

    it('a regra de percentual usa a MESMA permissão da listagem', async () => {
      comViewAll(false);
      await controller.findRules(SELLER);

      expect(permissions.hasAnyPermission).toHaveBeenCalledWith(SELLER.id, COMPANY, [
        'sales.commissions.view-all',
      ]);
    });
  });

  describe('POST /commissions/rules (createRule)', () => {
    const DIRECTOR = { id: 'dir-1', role: 'DIRECTOR', companyId: COMPANY };

    it('força o companyId do JWT, ignorando o do body (anti-IDOR, padrão #450)', () => {
      controller.createRule(
        {
          userId: 'seller-1',
          percentRate: 5,
          validFrom: '2026-01-01',
          companyId: 'empresa-de-outro', // atacante tenta criar regra em outra empresa
        },
        DIRECTOR,
      );

      expect(service.createRule).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: COMPANY }),
      );
    });

    it('configurar continua sendo permissão SEPARADA de view-all', () => {
      // `sales.commissions.configure` gateia esta rota; ver ampla não configura,
      // e configurar não é pré-requisito de ver. AUDITOR é o caso vivo: recebe
      // view-all e NÃO recebe configure.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const src: string = require('fs').readFileSync(
        'src/modules/commission/commission.controller.ts',
        'utf-8',
      );
      expect(src).toMatch(/@RequirePermission\('sales\.commissions\.configure'\)/);
    });
  });
});
