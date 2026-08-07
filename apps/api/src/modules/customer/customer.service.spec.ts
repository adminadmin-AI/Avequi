import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
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

const mockAuditService = {
  log: jest.fn().mockResolvedValue(undefined),
};

async function drain(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk.toString());
  return chunks.join('');
}

describe('CustomerService — tags e anexos (#476)', () => {
  let service: CustomerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get(CustomerService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));
    mockAuditService.log.mockResolvedValue(undefined);
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

  describe('exportCsv (#1032 — export server-side com cursor)', () => {
    const actor = { userId: 'u-1', sessionId: 's-1', ipAddress: '10.0.0.1', userAgent: 'jest' };

    it('usa EXATAMENTE o mesmo where de findAll para os mesmos filtros (search/tagId/type/isActive)', async () => {
      mockPrisma.customer.findMany
        .mockResolvedValueOnce([]) // findAll
        .mockResolvedValueOnce([]); // exportCsv (1º lote)

      const query = { search: 'João', tagId: 't-1', type: 'PERSON' as any, isActive: 'true' };
      await service.findAll('co-1', query);
      const whereFromFindAll = mockPrisma.customer.findMany.mock.calls[0][0].where;

      await drain(service.exportCsv('co-1', query, actor));
      const whereFromExport = mockPrisma.customer.findMany.mock.calls[1][0].where;

      expect(whereFromExport).toEqual(whereFromFindAll);
    });

    it('tenancy: companyId sempre no where, mesmo sem nenhum outro filtro', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      await drain(service.exportCsv('co-isolada', {}, actor));
      expect(mockPrisma.customer.findMany.mock.calls[0][0].where).toEqual({ companyId: 'co-isolada' });
    });

    it('usa cursor + take como chaves literais (nunca findMany aberto — list-query-lint)', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      await drain(service.exportCsv('co-1', {}, actor));
      const args = mockPrisma.customer.findMany.mock.calls[0][0];
      expect(args.take).toBeGreaterThan(0);
      expect(args.cursor).toBeUndefined(); // 1º lote sem cursor
      expect(args.orderBy).toEqual({ id: 'asc' });
    });

    it('percorre múltiplos lotes via cursor e entrega o CONJUNTO COMPLETO (não só uma página)', async () => {
      // Lote de export é CSV_EXPORT_BATCH_SIZE (500) — só fecha o 1º lote e
      // pede o próximo quando ele vem CHEIO. Simula exatamente isso: 500 no
      // 1º lote (força a 2ª chamada) + 1 no 2º (fecha, menor que o teto).
      const mk = (id: string, name: string) => ({
        id, name, type: 'PERSON', document: null, email: null,
        city: null, state: null, isActive: true, billingBlocked: false, billingBlockReason: null,
        tagLinks: [],
      });
      const page1 = Array.from({ length: 500 }, (_, i) => mk(`c${i + 1}`, `Cliente ${i + 1}`));
      const page2 = [mk('c501', 'Cliente 501')];
      mockPrisma.customer.findMany
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      const csv = await drain(service.exportCsv('co-1', {}, actor));

      // o último cliente (do 2º lote) está no CSV — não só a "página" do 1º lote
      expect(csv).toContain('Cliente 1');
      expect(csv).toContain('Cliente 500');
      expect(csv).toContain('Cliente 501');
      expect(mockPrisma.customer.findMany).toHaveBeenCalledTimes(2);

      // 2º lote pediu cursor = id do último item do 1º lote (nunca busca tudo de uma vez)
      expect(mockPrisma.customer.findMany.mock.calls[1][0].cursor).toEqual({ id: 'c500' });
    });

    it('nunca chama findMany sem where (proteção anti-vazamento cross-tenant)', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      await drain(service.exportCsv('co-1', { search: 'x' }, actor));
      for (const call of mockPrisma.customer.findMany.mock.calls) {
        expect(call[0].where.companyId).toBe('co-1');
      }
    });

    it('audita (LGPD): registra EXPORT com entity Customer, companyId, ator e filtros — antes de abrir o stream', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      service.exportCsv('co-1', { search: 'João', tagId: 't-1' }, actor);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'co-1',
          userId: 'u-1',
          sessionId: 's-1',
          entity: 'Customer',
          action: AuditAction.EXPORT,
          module: 'customer',
          newValue: expect.objectContaining({ search: 'João', tagId: 't-1' }),
          ipAddress: '10.0.0.1',
          userAgent: 'jest',
        }),
      );
    });

    it('auditoria nunca bloqueia o export mesmo se AuditService rejeitar (best-effort)', async () => {
      mockAuditService.log.mockRejectedValue(new Error('fila indisponível'));
      mockPrisma.customer.findMany.mockResolvedValue([]);

      await expect(drain(service.exportCsv('co-1', {}, actor))).resolves.toBeDefined();
    });

    it('falha de auditoria é LOGADA, nunca engolida em silêncio (#1032)', async () => {
      const erro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mockAuditService.log.mockRejectedValue(new Error('fila indisponível'));
      mockPrisma.customer.findMany.mockResolvedValue([]);

      await drain(service.exportCsv('co-1', {}, actor));
      // microtask do .catch() do fire-and-forget
      await Promise.resolve();

      expect(erro).toHaveBeenCalledWith(expect.stringContaining('Falha ao auditar export'));
      erro.mockRestore();
    });

    it('audita a CONCLUSÃO com rowCount — trilha registra o tamanho do que saiu (#1032)', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        { id: 'c1', name: 'A', tagLinks: [] },
        { id: 'c2', name: 'B', tagLinks: [] },
      ]);

      await drain(service.exportCsv('co-1', {}, actor));

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.EXPORT,
          newValue: expect.objectContaining({ phase: 'completed', rowCount: 2 }),
        }),
      );
    });

    it('export abortado no meio deixa só o registro de início, sem rowCount (#1032)', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([{ id: 'c1', name: 'A', tagLinks: [] }]);

      // consome só o cabeçalho e abandona o stream, como um cliente que
      // cancela o download — o generator nunca chega ao fim.
      const stream = service.exportCsv('co-1', {}, actor);
      await stream[Symbol.asyncIterator]().next();
      stream.destroy();

      const fases = mockAuditService.log.mock.calls.map((c: any[]) => c[0].newValue.phase);
      expect(fases).toContain('started');
      expect(fases).not.toContain('completed');
    });
  });

  describe('findOptions (#1028 parte 2 — combobox de formulário)', () => {
    it('escopa por companyId, sem envelope de paginação (array puro)', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

      const res = await service.findOptions('co-1', {});

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'co-1' } }),
      );
      expect(res).toEqual([{ id: 'c1' }, { id: 'c2' }]);
    });

    it('aplica busca por nome ou documento (insensível a caso) como where do Prisma', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      await service.findOptions('co-1', { search: 'joao' });

      const args = mockPrisma.customer.findMany.mock.calls[0][0];
      expect(args.where.OR).toEqual([
        { name: { contains: 'joao', mode: 'insensitive' } },
        { document: { contains: 'joao', mode: 'insensitive' } },
      ]);
    });

    it('aplica isActive só quando informado (sem filtro por padrão)', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      await service.findOptions('co-1', {});
      expect(mockPrisma.customer.findMany.mock.calls[0][0].where.isActive).toBeUndefined();

      await service.findOptions('co-1', { isActive: 'true' });
      expect(mockPrisma.customer.findMany.mock.calls[1][0].where.isActive).toBe(true);
    });

    it('teto do take: default 50, clampa acima de 100 e ignora page/pageSize (não pagina)', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      await service.findOptions('co-1', {});
      expect(mockPrisma.customer.findMany.mock.calls[0][0].take).toBe(50);

      await service.findOptions('co-1', { take: 500 });
      expect(mockPrisma.customer.findMany.mock.calls[1][0].take).toBe(100);
    });

    it('payload mínimo: só {id, name, document} — nada de crédito/endereço/dados sensíveis', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      await service.findOptions('co-1', {});
      expect(mockPrisma.customer.findMany.mock.calls[0][0].select).toEqual({
        id: true,
        name: true,
        document: true,
      });
    });

    it('ordenação estável (nome + desempate por id)', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      await service.findOptions('co-1', {});
      expect(mockPrisma.customer.findMany.mock.calls[0][0].orderBy).toEqual([
        { name: 'asc' },
        { id: 'asc' },
      ]);
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
