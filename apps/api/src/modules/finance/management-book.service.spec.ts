import { Test } from '@nestjs/testing';
import { ManagementBookService } from './management-book.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceService } from './finance.service';
import { FinanceKpiService } from './finance-kpi.service';
import { ProvisionService } from './provision.service';
import { DebtService } from './debt.service';

const mockPrisma = {
  saleItem: { findMany: jest.fn().mockResolvedValue([]) },
  financialEntry: { findMany: jest.fn().mockResolvedValue([]) },
  alert: { findFirst: jest.fn(), create: jest.fn() },
};

const stubs = {
  finance: {
    getDre: jest.fn().mockResolvedValue({ receita: 100 }),
    getCashFlowMonthly: jest.fn().mockResolvedValue({ projection: [{ month: '2026-07', inflow: 1, outflow: 2, netFlow: -1, projectedBalance: -1 }] }),
  },
  kpi: {
    getKpis: jest.fn().mockResolvedValue({ pmr: 15, pmp: 30, cicloFinanceiro: -15, cashRunwayDias: 90, caixaDisponivel: 0, recebiveisAbertos: 0, pagaveisAbertos: 0, endividamentoLiquido: 0, liquidezCorrente: null }),
    getMarginBySku: jest.fn().mockResolvedValue({ totais: { receita: 0 }, items: Array.from({ length: 15 }, (_, i) => ({ sku: `S${i}`, margemContribuicao: i })) }),
  },
  provision: { getPdd: jest.fn().mockResolvedValue({ totalVencido: 10, totalProvisao: 1, faixas: [] }) },
  debt: { dashboard: jest.fn().mockResolvedValue({ saldoDevedorTotal: 5, contratosAtivos: 1, porTipo: [] }) },
};

describe('ManagementBookService (#394)', () => {
  let service: ManagementBookService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ManagementBookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FinanceService, useValue: stubs.finance },
        { provide: FinanceKpiService, useValue: stubs.kpi },
        { provide: ProvisionService, useValue: stubs.provision },
        { provide: DebtService, useValue: stubs.debt },
      ],
    }).compile();
    service = module.get(ManagementBookService);
    jest.clearAllMocks();
    mockPrisma.saleItem.findMany.mockResolvedValue([]);
    mockPrisma.financialEntry.findMany.mockResolvedValue([]);
  });

  it('consolida todas as seções do mês pedido (período correto)', async () => {
    const book = await service.getBook('co-1', '2026-06');
    expect(book.referencia).toBe('2026-06');
    expect(book.period).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(stubs.finance.getDre).toHaveBeenCalledWith('co-1', { from: '2026-06-01', to: '2026-06-30' });
    expect(book.margemPorSku.top10).toHaveLength(10); // corta em 10
    expect(book.kpis.pmr).toBe(15);
    expect(book.pdd.totalProvisao).toBe(1);
    expect(book.endividamento.saldoDevedorTotal).toBe(5);
  });

  it('aging agrupa AR/AP por faixa de atraso', async () => {
    const hoje = new Date();
    mockPrisma.financialEntry.findMany.mockResolvedValue([
      { type: 'RECEIVABLE', amount: 1000, paidAmount: 0, dueDate: new Date(hoje.getTime() - 10 * 86_400_000) },
      { type: 'PAYABLE', amount: 500, paidAmount: 0, dueDate: new Date(hoje.getTime() - 70 * 86_400_000) },
    ]);
    const book = await service.getBook('co-1', '2026-06');
    const f1 = book.aging.find((b: any) => b.faixa === '0-30')!;
    const f3 = book.aging.find((b: any) => b.faixa === '61-90')!;
    expect(f1.receber).toBe(1000);
    expect(f3.pagar).toBe(500);
  });

  it('gera xlsx com as abas do book', async () => {
    const buf = await service.getBookXlsx('co-1', '2026-06');
    expect(buf.length).toBeGreaterThan(1000);
    // assinatura zip do xlsx
    expect(buf.subarray(0, 2).toString()).toBe('PK');
  });
});
