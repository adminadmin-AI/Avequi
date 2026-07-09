import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ComplianceService } from './compliance.service';

const mockPrisma = {
  product: { count: jest.fn() },
  taxRule: { count: jest.fn(), groupBy: jest.fn() },
  fiscalDocument: { groupBy: jest.fn(), findMany: jest.fn() },
  serialNumber: { count: jest.fn() },
};

describe('ComplianceService (#503 parte 2)', () => {
  let service: ComplianceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ComplianceService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ComplianceService);
    jest.clearAllMocks();
  });

  function arm(opts: {
    products?: [number, number, number]; // [ativos, comNcm, comClassTrib]
    rules?: [number, number]; // [vigentes, comIbsCbs]
    coverage?: Array<{ operationType: string; count: number }>;
    emission?: Array<{ status: string; count: number }>;
    serials?: [number, number]; // [sold, soldComBin]
  }) {
    const [p, ncm, ct] = opts.products ?? [0, 0, 0];
    mockPrisma.product.count
      .mockResolvedValueOnce(p)
      .mockResolvedValueOnce(ncm)
      .mockResolvedValueOnce(ct);
    const [rv, ribs] = opts.rules ?? [0, 0];
    mockPrisma.taxRule.count.mockResolvedValueOnce(rv).mockResolvedValueOnce(ribs);
    mockPrisma.taxRule.groupBy.mockResolvedValue(
      (opts.coverage ?? []).map((c) => ({ operationType: c.operationType, _count: { _all: c.count } })),
    );
    mockPrisma.fiscalDocument.groupBy.mockResolvedValue(
      (opts.emission ?? []).map((e) => ({ status: e.status, _count: { _all: e.count } })),
    );
    mockPrisma.fiscalDocument.findMany.mockResolvedValue([]);
    const [sold, soldBin] = opts.serials ?? [0, 0];
    mockPrisma.serialNumber.count.mockResolvedValueOnce(sold).mockResolvedValueOnce(soldBin);
  }

  it('cenário GDR atual: 310 produtos sem cClassTrib → reforma denuncia o gap', async () => {
    arm({
      products: [310, 305, 0], // 5 sem NCM, 310 sem cClassTrib
      rules: [43, 22],
      coverage: [{ operationType: 'VENDA_INTERNA', count: 10 }],
      emission: [{ status: 'AUTHORIZED', count: 50 }],
      serials: [10, 10],
    });

    const r = await service.overview('co-1');

    expect(r.reforma.withoutCClassTrib).toBe(310);
    expect(r.reforma.withoutNcm).toBe(5);
    expect(r.reforma.daysLeft).toBeLessThan(30); // hoje 09/07/26, prazo 03/08/26
    // 30%*ncm(0.9839) + 50%*classTrib(0) + 20%*rules(0.5116) ≈ 39-40
    expect(r.reforma.score).toBeGreaterThan(35);
    expect(r.reforma.score).toBeLessThan(45);
    expect(r.ruleCoverage.coveredCount).toBe(1);
    expect(r.ruleCoverage.totalOperations).toBe(13);
    expect(r.emission30d.successRate).toBe(100);
    expect(r.vehicular.soldWithoutBin).toBe(0);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
  });

  it('tudo conforme → score 100', async () => {
    const allOps = [
      'VENDA_INTERNA', 'VENDA_INTERESTADUAL', 'DEVOLUCAO_VENDA', 'TRANSFERENCIA_INTERNA',
      'TRANSFERENCIA_INTERESTADUAL', 'COMPRA_INTERNA', 'COMPRA_INTERESTADUAL', 'DEVOLUCAO_COMPRA',
      'REMESSA_CONSERTO', 'RETORNO_CONSERTO', 'AMOSTRA_GRATIS', 'BONIFICACAO', 'INDUSTRIALIZACAO',
    ];
    arm({
      products: [100, 100, 100],
      rules: [40, 40],
      coverage: allOps.map((op) => ({ operationType: op, count: 2 })),
      emission: [{ status: 'AUTHORIZED', count: 30 }],
      serials: [5, 5],
    });
    const r = await service.overview('co-1');
    expect(r.score).toBe(100);
  });

  it('sem emissão e sem chassi vendido → dimensões neutras (não penaliza)', async () => {
    arm({ products: [10, 10, 10], rules: [5, 5], coverage: [], emission: [], serials: [0, 0] });
    const r = await service.overview('co-1');
    expect(r.emission30d.successRate).toBe(100);
    expect(r.vehicular.score).toBe(100);
  });

  it('rejeições contam contra a taxa de sucesso; pendentes ficam de fora', async () => {
    arm({
      products: [10, 10, 10],
      rules: [5, 5],
      coverage: [],
      emission: [
        { status: 'AUTHORIZED', count: 8 },
        { status: 'REJECTED', count: 1 },
        { status: 'ERROR', count: 1 },
        { status: 'PENDING', count: 5 },
      ],
      serials: [0, 0],
    });
    const r = await service.overview('co-1');
    expect(r.emission30d.successRate).toBe(80); // 8/(8+2), pendentes fora
    expect(r.emission30d.pending).toBe(5);
  });

  it('multi-tenant: todas as consultas filtram companyId', async () => {
    arm({ products: [1, 1, 1], rules: [1, 1], coverage: [], emission: [], serials: [0, 0] });
    await service.overview('co-X');
    for (const call of [
      ...mockPrisma.product.count.mock.calls,
      ...mockPrisma.taxRule.count.mock.calls,
      ...mockPrisma.serialNumber.count.mock.calls,
    ]) {
      expect(call[0].where.companyId).toBe('co-X');
    }
    expect(mockPrisma.fiscalDocument.groupBy.mock.calls[0][0].where.companyId).toBe('co-X');
  });
});
