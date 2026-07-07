import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { PrismaService } from '../../prisma/prisma.service';

const OFX_SAMPLE = `
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260706
<TRNAMT>4500.00
<FITID>FIT-001
<MEMO>PIX RECEBIDO NF 000045
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260707
<TRNAMT>-89.90
<FITID>FIT-002
<MEMO>TARIFA PACOTE SERVICOS
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const mockPrisma = {
  bankAccount: { findFirst: jest.fn() },
  bankStatement: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  financialEntry: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
};

describe('ReconciliationService (#385)', () => {
  let service: ReconciliationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ReconciliationService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ReconciliationService);
    jest.clearAllMocks();
    mockPrisma.bankAccount.findFirst.mockResolvedValue({ id: 'acc-1' });
    mockPrisma.bankStatement.findFirst.mockResolvedValue(null);
    mockPrisma.bankStatement.findMany.mockResolvedValue([]);
    mockPrisma.bankStatement.create.mockResolvedValue({});
    mockPrisma.bankStatement.update.mockResolvedValue({});
    mockPrisma.financialEntry.findFirst.mockResolvedValue(null);
    mockPrisma.financialEntry.findMany.mockResolvedValue([]);
  });

  it('importa OFX criando statements com valor absoluto e tipo', async () => {
    const result = await service.importOfx('co-1', 'acc-1', OFX_SAMPLE);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    const debito = mockPrisma.bankStatement.create.mock.calls[1][0].data;
    expect(debito.type).toBe('DEBIT');
    expect(debito.amount).toBe(89.9); // TRNAMT negativo vira valor absoluto
    expect(debito.fitId).toBe('FIT-002');
  });

  it('reimportar o mesmo OFX não duplica (idempotência por fitId)', async () => {
    mockPrisma.bankStatement.findFirst.mockResolvedValue({ id: 'st-existente' });
    const result = await service.importOfx('co-1', 'acc-1', OFX_SAMPLE);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);
    expect(mockPrisma.bankStatement.create).not.toHaveBeenCalled();
  });

  it('match exato: CREDIT casa com RECEIVABLE de mesmo valor e vencimento próximo', async () => {
    mockPrisma.bankStatement.findMany
      .mockResolvedValueOnce([
        {
          id: 'st-1',
          amount: 4500,
          transactionDate: new Date('2026-07-06'),
          description: 'PIX RECEBIDO',
          reference: null,
          type: 'CREDIT',
        },
      ]) // UNMATCHED
      .mockResolvedValueOnce([]); // usadas
    mockPrisma.financialEntry.findFirst.mockResolvedValueOnce({ id: 'fe-1' });

    const result = await service.autoMatch('co-1');
    expect(result.matched).toBe(1);
    const where = mockPrisma.financialEntry.findFirst.mock.calls[0][0].where;
    expect(where.type).toBe('RECEIVABLE');
    expect(where.amount.gte).toBeCloseTo(4499.99);
    expect(where.amount.lte).toBeCloseTo(4500.01);
    expect(mockPrisma.bankStatement.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchStatus: 'MATCHED', matchedEntryId: 'fe-1' }) }),
    );
  });

  it('match por referência: número do memo contido na description da entry', async () => {
    mockPrisma.bankStatement.findMany
      .mockResolvedValueOnce([
        {
          id: 'st-1',
          amount: 4500,
          transactionDate: new Date('2026-07-06'),
          description: 'PIX NF 000045',
          reference: null,
          type: 'CREDIT',
        },
      ])
      .mockResolvedValueOnce([]);
    // sem match exato; acha por referência
    mockPrisma.financialEntry.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'fe-ref' });

    const result = await service.autoMatch('co-1');
    expect(result.matched).toBe(1);
    const whereRef = mockPrisma.financialEntry.findFirst.mock.calls[1][0].where;
    expect(whereRef.description).toEqual({ contains: '000045' });
  });

  it('sem match fica UNMATCHED', async () => {
    mockPrisma.bankStatement.findMany
      .mockResolvedValueOnce([
        {
          id: 'st-1',
          amount: 77,
          transactionDate: new Date('2026-07-06'),
          description: 'TARIFA',
          reference: null,
          type: 'DEBIT',
        },
      ])
      .mockResolvedValueOnce([]);
    const result = await service.autoMatch('co-1');
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(1);
    expect(mockPrisma.bankStatement.update).not.toHaveBeenCalled();
  });

  it('matchManual rejeita entry já conciliada com outro statement', async () => {
    mockPrisma.bankStatement.findFirst
      .mockResolvedValueOnce({ id: 'st-1' }) // o statement
      .mockResolvedValueOnce({ id: 'st-outro' }); // entry já usada
    mockPrisma.financialEntry.findFirst.mockResolvedValue({ id: 'fe-1' });
    await expect(service.matchManual('co-1', 'st-1', 'fe-1')).rejects.toThrow(BadRequestException);
  });

  it('createEntryFromStatement cria lançamento PAID e concilia (tarifa bancária)', async () => {
    mockPrisma.bankStatement.findFirst.mockResolvedValue({
      id: 'st-1',
      matchStatus: 'UNMATCHED',
      type: 'DEBIT',
      amount: 89.9,
      transactionDate: new Date('2026-07-07'),
      description: 'TARIFA PACOTE SERVICOS',
    });
    mockPrisma.financialEntry.create.mockResolvedValue({ id: 'fe-novo' });

    await service.createEntryFromStatement('co-1', 'st-1');
    const data = mockPrisma.financialEntry.create.mock.calls[0][0].data;
    expect(data.type).toBe('PAYABLE');
    expect(data.status).toBe('PAID');
    expect(data.amount).toBe(89.9);
    expect(mockPrisma.bankStatement.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchedEntryId: 'fe-novo' }) }),
    );
  });
});
