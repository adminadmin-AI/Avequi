import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Primeiros testes do módulo supplier — focados no anti-fraude bancário (#864):
 * TROCA de chave PIX/dados bancários (A→B) gera AuditLog BANKING_UPDATE com
 * troca=true + alerta no sino; primeiro preenchimento (vazio→A, ex.: captura
 * inteligente #863) audita com troca=false e NÃO alerta (decisão do Rafael).
 */

const mockPrisma = {
  supplier: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  auditLog: { create: jest.fn() },
  alert: { create: jest.fn() },
};

const baseSupplier = {
  id: 'sup-1',
  companyId: 'co-1',
  name: 'Fornecedor Teste',
  pixKey: null as string | null,
  bankName: null as string | null,
  bankAgency: null as string | null,
  bankAccount: null as string | null,
};

const USER = { id: 'user-7', companyId: 'co-1' };

describe('SupplierService — update (anti-fraude bancário #864)', () => {
  let service: SupplierService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SupplierService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(SupplierService);
    jest.clearAllMocks();
    mockPrisma.supplier.update.mockResolvedValue(baseSupplier);
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.alert.create.mockResolvedValue({});
  });

  it('TROCA de chave PIX (A→B): audita BANKING_UPDATE troca=true + alerta no sino', async () => {
    mockPrisma.supplier.findFirst.mockResolvedValue({ ...baseSupplier, pixKey: 'antiga@x.com' });

    await service.update('sup-1', { pixKey: 'nova@y.com' } as never, USER);

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BANKING_UPDATE',
          userId: 'user-7',
          payload: expect.objectContaining({
            id: 'sup-1',
            troca: true,
            changes: { pixKey: { from: 'antiga@x.com', to: 'nova@y.com' } },
          }),
        }),
      }),
    );
    expect(mockPrisma.alert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SUPPLIER_BANKING_CHANGED',
          severity: 'WARNING',
          entityId: 'sup-1',
          entityType: 'Supplier',
        }),
      }),
    );
  });

  it('PRIMEIRO preenchimento (vazio→A): audita troca=false e NÃO alerta', async () => {
    mockPrisma.supplier.findFirst.mockResolvedValue({ ...baseSupplier, pixKey: null });

    await service.update('sup-1', { pixKey: 'primeira@x.com' } as never, USER);

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BANKING_UPDATE',
          payload: expect.objectContaining({ troca: false }),
        }),
      }),
    );
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });

  it('troca de dados bancários (banco/agência/conta) também alerta', async () => {
    mockPrisma.supplier.findFirst.mockResolvedValue({
      ...baseSupplier,
      bankName: 'Banco A',
      bankAccount: '111-1',
    });

    await service.update('sup-1', { bankName: 'Banco B', bankAccount: '999-9' } as never, USER);

    expect(mockPrisma.alert.create).toHaveBeenCalled();
    const bankingCall = mockPrisma.auditLog.create.mock.calls.find(
      (c) => c[0].data.action === 'BANKING_UPDATE',
    );
    expect(Object.keys(bankingCall![0].data.payload.changes)).toEqual(
      expect.arrayContaining(['bankName', 'bankAccount']),
    );
  });

  it('update sem campos bancários: NÃO gera BANKING_UPDATE nem alerta', async () => {
    mockPrisma.supplier.findFirst.mockResolvedValue({ ...baseSupplier, pixKey: 'fica@x.com' });

    await service.update('sup-1', { name: 'Novo Nome' } as never, USER);

    const actions = mockPrisma.auditLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toEqual(['UPDATE']); // só a auditoria genérica
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });

  it('mandar o MESMO valor não conta como mudança', async () => {
    mockPrisma.supplier.findFirst.mockResolvedValue({ ...baseSupplier, pixKey: 'igual@x.com' });

    await service.update('sup-1', { pixKey: 'igual@x.com' } as never, USER);

    const actions = mockPrisma.auditLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toEqual(['UPDATE']);
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });

  it('fornecedor de outra empresa = 404 (escopo do tenant)', async () => {
    mockPrisma.supplier.findFirst.mockResolvedValue(null);
    await expect(service.update('sup-1', {} as never, USER)).rejects.toThrow(NotFoundException);
    expect(mockPrisma.supplier.update).not.toHaveBeenCalled();
  });
});
