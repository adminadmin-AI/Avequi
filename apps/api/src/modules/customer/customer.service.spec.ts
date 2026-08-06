import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerService } from './customer.service';

const mockPrisma = {
  customer: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  },
  customerTag: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), delete: jest.fn() },
  customerTagLink: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
  customerAttachment: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), delete: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
};

describe('CustomerService — tags e anexos (#476)', () => {
  let service: CustomerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CustomerService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(CustomerService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));
  });

  describe('tags', () => {
    it('createTag exige nome e trata duplicidade (P2002 → 400 amigável)', async () => {
      await expect(service.createTag('co-1', { name: '  ' })).rejects.toThrow(BadRequestException);
      mockPrisma.customerTag.create.mockRejectedValue({ code: 'P2002' });
      await expect(service.createTag('co-1', { name: 'Revenda' })).rejects.toThrow(/já existe/);
    });

    it('setCustomerTags substitui o conjunto e IGNORA tag de outra company (tenancy)', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
      mockPrisma.customerTag.findMany.mockResolvedValue([{ id: 'tag-own' }]); // tag alheia filtrada
      mockPrisma.customerTagLink.findMany.mockResolvedValue([]);

      await service.setCustomerTags('co-1', 'c-1', ['tag-own', 'tag-ALHEIA']);

      expect(mockPrisma.customerTag.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['tag-own', 'tag-ALHEIA'] },
        companyId: 'co-1',
      });
      expect(mockPrisma.customerTagLink.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'c-1' } });
      expect(mockPrisma.customerTagLink.createMany.mock.calls[0][0].data).toEqual([
        { customerId: 'c-1', tagId: 'tag-own' },
      ]);
    });

    it('setCustomerTags em cliente de outra company → NotFound', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      await expect(service.setCustomerTags('co-1', 'c-x', [])).rejects.toThrow(NotFoundException);
    });

  });

  describe('findAll (#1028)', () => {
    it('escopa por companyId e devolve o envelope paginado', async () => {
      mockPrisma.customer.count.mockResolvedValue(2);
      mockPrisma.customer.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

      const res = await service.findAll('co-1', {});

      expect(mockPrisma.customer.count).toHaveBeenCalledWith({ where: { companyId: 'co-1' } });
      expect(res).toEqual({ items: [{ id: 'c1' }, { id: 'c2' }], total: 2, page: 1, pageSize: 25 });
    });

    it('filtra por tagId (#476) no where do Prisma', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      await service.findAll('co-1', { tagId: 't-1' });
      expect(mockPrisma.customer.findMany.mock.calls[0][0].where.tagLinks).toEqual({
        some: { tagId: 't-1' },
      });
    });

    it('aplica busca (nome/documento) e isActive como where do Prisma — nunca em memória', async () => {
      await service.findAll('co-1', { search: 'João', isActive: 'false' });

      const where = mockPrisma.customer.findMany.mock.calls[0][0].where;
      expect(where.companyId).toBe('co-1');
      expect(where.isActive).toBe(false);
      expect(where.OR).toEqual([
        { name: { contains: 'João', mode: 'insensitive' } },
        { document: { contains: 'João', mode: 'insensitive' } },
      ]);
    });

    it('usa select explícito e traz tag só como {id, name, color} (não o objeto inteiro)', async () => {
      await service.findAll('co-1', {});

      const args = mockPrisma.customer.findMany.mock.calls[0][0];
      expect(args.select).toEqual({
        id: true,
        type: true,
        name: true,
        document: true,
        email: true,
        city: true,
        state: true,
        isActive: true,
        billingBlocked: true,
        billingBlockReason: true,
        tagLinks: { select: { tag: { select: { id: true, name: true, color: true } } } },
      });
      // não usa include (que traria o objeto Tag inteiro)
      expect(args.include).toBeUndefined();
    });

    it('respeita page/pageSize e aplica desempate por id na ordenação', async () => {
      await service.findAll('co-1', { page: 3, pageSize: 50 });

      const args = mockPrisma.customer.findMany.mock.calls[0][0];
      expect(args.skip).toBe(100);
      expect(args.take).toBe(50);
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    });
  });

  describe('anexos', () => {
    const file = (size: number) => ({
      buffer: Buffer.alloc(10),
      mimetype: 'application/pdf',
      originalname: 'cnh.pdf',
      size,
    });

    it('rejeita anexo acima de 10MB', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
      await expect(service.addAttachment('co-1', 'c-1', file(11 * 1024 * 1024))).rejects.toThrow(/10MB/);
    });

    it('upload grava binário e retorna SÓ metadados', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
      mockPrisma.customerAttachment.create.mockResolvedValue({
        id: 'att-1', filename: 'cnh.pdf', mimeType: 'application/pdf', size: 10, createdAt: new Date(),
      });
      const res = await service.addAttachment('co-1', 'c-1', file(10), 'u-1');
      expect(res).not.toHaveProperty('data');
      const arg = mockPrisma.customerAttachment.create.mock.calls[0][0];
      expect(arg.data.companyId).toBe('co-1');
      expect(arg.select).toEqual({ id: true, filename: true, mimeType: true, size: true, createdAt: true });
    });

    it('listAttachments não expõe o binário e valida tenancy do cliente', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      await expect(service.listAttachments('co-1', 'c-x')).rejects.toThrow(NotFoundException);

      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
      mockPrisma.customerAttachment.findMany.mockResolvedValue([]);
      await service.listAttachments('co-1', 'c-1');
      expect(mockPrisma.customerAttachment.findMany.mock.calls[0][0].select).not.toHaveProperty('data');
    });

    it('download/delete de anexo de outra company → NotFound (tenancy)', async () => {
      mockPrisma.customerAttachment.findFirst.mockResolvedValue(null);
      await expect(service.getAttachment('co-1', 'att-x')).rejects.toThrow(NotFoundException);
      await expect(service.deleteAttachment('co-1', 'att-x')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.customerAttachment.findFirst.mock.calls[0][0].where).toEqual({
        id: 'att-x', companyId: 'co-1',
      });
    });
  });
});
