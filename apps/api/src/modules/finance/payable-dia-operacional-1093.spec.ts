import { Test } from '@nestjs/testing';
import { FinanceService } from './finance.service';
import { SupplierAdvanceService } from './supplier-advance.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * #1093 — vencimento da conta a pagar de compra como DATA DE NEGÓCIO
 * (mesma causa raiz da #901, que corrigiu o lado dos recebíveis de venda).
 *
 * O container roda em UTC, três horas à frente de São Paulo: entre 21h e
 * meia-noite, `new Date()` já está no dia seguinte. O gerador de CP somava o
 * prazo a esse instante, então uma mercadoria recebida às 22h de 14/08
 * ganhava vencimento contado a partir de 15/08 — um dia adiante do combinado
 * com o fornecedor ("recebi, pago em 30 dias").
 *
 * A regra corrigida: o prazo parte do DIA OPERACIONAL em America/Sao_Paulo e
 * o vencimento é gravado na representação canônica de data pura
 * (`YYYY-MM-DDT00:00:00.000Z`) — a mesma forma dos títulos migrados do Omie e
 * dos recebíveis de venda pós-#901.
 *
 * Todos os testes congelam o relógio. A janela crítica é 21h–00h BRT.
 */

const congelar = (iso: string) => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(iso));
};

/** Vencimento como o banco guarda: data pura à meia-noite UTC. */
const venc = (dia: string) => new Date(`${dia}T00:00:00.000Z`);

const mockPrisma = {
  financialEntry: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
  purchaseOrder: { findUnique: jest.fn().mockResolvedValue(null) },
};

describe('createPayableForReceipt — dia operacional (#1093)', () => {
  let service: FinanceService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: SupplierAdvanceService,
          useValue: { applyToPayable: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();

    service = module.get(FinanceService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
    mockPrisma.financialEntry.findUnique.mockResolvedValue(null);
    mockPrisma.financialEntry.create.mockResolvedValue({ id: 'fe-1' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const receber = (goodsReceiptId = 'gr-1') =>
    service.createPayableForReceipt({
      companyId: 'co-1',
      purchaseOrderId: 'po-1',
      goodsReceiptId,
      amount: 450,
    });

  const dueDateGravado = (): Date =>
    mockPrisma.financialEntry.create.mock.calls[0][0].data.dueDate;

  it('meio do mês, horário comercial: 14/08 + 30 dias = 13/09', async () => {
    congelar('2026-08-14T17:00:00.000Z'); // 14:00 BRT
    await receber();
    expect(dueDateGravado()).toEqual(venc('2026-09-13'));
  });

  it('O BUG DA ISSUE: recebimento às 22h BRT continua contando do MESMO dia', async () => {
    // 22:00 BRT de 14/08 = 01:00 UTC de 15/08. Antes da correção, o prazo
    // partia de 15/08 e o vencimento saía 14/09 — um dia adiante.
    congelar('2026-08-15T01:00:00.000Z');
    await receber();
    expect(dueDateGravado()).toEqual(venc('2026-09-13'));
  });

  it('antes e depois das 21h BRT no mesmo dia operacional dão o MESMO vencimento', async () => {
    congelar('2026-08-14T23:59:00.000Z'); // 20:59 BRT de 14/08
    await receber('gr-antes');
    const antesDas21 = dueDateGravado();

    jest.clearAllMocks();
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
    mockPrisma.financialEntry.findUnique.mockResolvedValue(null);
    mockPrisma.financialEntry.create.mockResolvedValue({ id: 'fe-2' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    congelar('2026-08-15T00:01:00.000Z'); // 21:01 BRT, AINDA 14/08 em SP
    await receber('gr-depois');
    const depoisDas21 = dueDateGravado();

    expect(antesDas21).toEqual(depoisDas21);
    expect(antesDas21).toEqual(venc('2026-09-13'));
  });

  it('primeiro dia do mês: 01/09 + 30 = 01/10', async () => {
    congelar('2026-09-01T12:00:00.000Z'); // 09:00 BRT
    await receber();
    expect(dueDateGravado()).toEqual(venc('2026-10-01'));
  });

  it('último dia do mês: 31/08 + 30 = 30/09', async () => {
    congelar('2026-08-31T12:00:00.000Z');
    await receber();
    expect(dueDateGravado()).toEqual(venc('2026-09-30'));
  });

  it('virada de mês pelo prazo: 25/08 + 30 atravessa para 24/09', async () => {
    congelar('2026-08-25T12:00:00.000Z');
    await receber();
    expect(dueDateGravado()).toEqual(venc('2026-09-24'));
  });

  it('virada de ano: 15/12 + 30 = 14/01 do ano seguinte', async () => {
    congelar('2026-12-15T12:00:00.000Z');
    await receber();
    expect(dueDateGravado()).toEqual(venc('2027-01-14'));
  });

  it('o vencimento é gravado como DATA PURA — meia-noite UTC exata', async () => {
    congelar('2026-08-15T01:00:00.000Z'); // 22:00 BRT — pior caso
    await receber();
    const gravado = dueDateGravado();
    expect(gravado.toISOString()).toBe('2026-09-13T00:00:00.000Z');
    expect(gravado.getUTCHours()).toBe(0);
    expect(gravado.getUTCMinutes()).toBe(0);
    expect(gravado.getUTCSeconds()).toBe(0);
    expect(gravado.getUTCMilliseconds()).toBe(0);
  });

  it('dueDate explícito do chamador continua tendo precedência (contrato preservado)', async () => {
    congelar('2026-08-15T01:00:00.000Z');
    const explicito = venc('2026-11-05');
    await service.createPayableForReceipt({
      companyId: 'co-1',
      purchaseOrderId: 'po-1',
      goodsReceiptId: 'gr-explicito',
      amount: 450,
      dueDate: explicito,
    });
    expect(dueDateGravado()).toEqual(explicito);
  });
});
