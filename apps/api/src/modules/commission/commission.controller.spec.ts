import { CommissionController } from './commission.controller';
import { CommissionService } from './commission.service';

/**
 * Privacidade de comissões (decisão Rafael 04/07/2026):
 * vendedor (COMMERCIAL) só vê as PRÓPRIAS comissões e a própria regra,
 * mesmo que tente passar ?userId= de outro vendedor.
 * Perfis gestores (SA/DIR/MGR/FIN) continuam vendo tudo.
 */
describe('CommissionController — vendedor só vê a própria comissão', () => {
  let controller: CommissionController;
  let service: jest.Mocked<CommissionService>;

  const COMPANY = 'company-1';
  const SELLER = { id: 'seller-1', role: 'COMMERCIAL', companyId: COMPANY };
  const MANAGER = { id: 'mgr-1', role: 'MANAGER', companyId: COMPANY };

  beforeEach(() => {
    service = {
      findAll: jest.fn().mockResolvedValue([]),
      findRules: jest.fn().mockResolvedValue([]),
      approveBatch: jest.fn(),
      createRule: jest.fn(),
    } as unknown as jest.Mocked<CommissionService>;

    controller = new CommissionController(service);
  });

  describe('GET /commissions (findAll)', () => {
    it('COMMERCIAL sem filtro: força userId = usuário logado', () => {
      controller.findAll(SELLER);

      expect(service.findAll).toHaveBeenCalledWith(COMPANY, {
        userId: SELLER.id,
        status: undefined,
        from: undefined,
        to: undefined,
      });
    });

    it('COMMERCIAL tentando ?userId= de outro vendedor: filtro é sobrescrito', () => {
      controller.findAll(SELLER, 'outro-vendedor');

      expect(service.findAll).toHaveBeenCalledWith(
        COMPANY,
        expect.objectContaining({ userId: SELLER.id }),
      );
    });

    it('COMMERCIAL mantém os demais filtros (status/from/to)', () => {
      controller.findAll(SELLER, 'outro-vendedor', 'PENDING', '2026-01-01', '2026-12-31');

      expect(service.findAll).toHaveBeenCalledWith(COMPANY, {
        userId: SELLER.id,
        status: 'PENDING',
        from: '2026-01-01',
        to: '2026-12-31',
      });
    });

    it('MANAGER vê tudo: userId da query é respeitado', () => {
      controller.findAll(MANAGER, 'seller-1');

      expect(service.findAll).toHaveBeenCalledWith(
        COMPANY,
        expect.objectContaining({ userId: 'seller-1' }),
      );
    });

    it('MANAGER sem filtro: lista todas as comissões da empresa', () => {
      controller.findAll(MANAGER);

      expect(service.findAll).toHaveBeenCalledWith(
        COMPANY,
        expect.objectContaining({ userId: undefined }),
      );
    });
  });

  describe('GET /commissions/rules (findRules)', () => {
    it('COMMERCIAL só vê a própria regra de comissão', () => {
      controller.findRules(SELLER);

      expect(service.findRules).toHaveBeenCalledWith(COMPANY, SELLER.id);
    });

    it('MANAGER vê todas as regras', () => {
      controller.findRules(MANAGER);

      expect(service.findRules).toHaveBeenCalledWith(COMPANY, undefined);
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
  });
});
