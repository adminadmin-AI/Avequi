import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ProductService', () => {
  let service: ProductService;
  let prisma: any;

  const mockUser = { id: 'user-1', role: 'MANAGER', companyId: 'company-1' };

  beforeEach(async () => {
    prisma = {
      product: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
  });

  describe('create', () => {
    it('should throw BadRequestException when type=FINISHED_GOOD and no NCM', async () => {
      const dto = {
        sku: 'PROD-001',
        name: 'Test Product',
        type: 'FINISHED_GOOD' as any,
      };

      await expect(service.create(dto, mockUser)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(dto, mockUser)).rejects.toThrow(
        'Produto acabado exige NCM',
      );
    });

    it('should throw ConflictException when SKU already exists for the company', async () => {
      const dto = {
        sku: 'EXISTING-SKU',
        name: 'Test Product',
        type: 'RAW_MATERIAL' as any,
      };

      prisma.product.findUnique.mockResolvedValue({
        id: 'existing-id',
        ...dto,
      });

      await expect(service.create(dto, mockUser)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: { companyId_sku: { companyId: 'company-1', sku: 'EXISTING-SKU' } },
      });
    });

    it('should succeed when type=FINISHED_GOOD and NCM is provided', async () => {
      const dto = {
        sku: 'CAL-001',
        name: 'Calçado Social',
        type: 'FINISHED_GOOD' as any,
        ncm: '6403.99.00',
      };

      prisma.product.findUnique.mockResolvedValue(null);
      prisma.product.create.mockResolvedValue({ id: 'new-id', ...dto });

      const result = await service.create(dto, mockUser);

      expect(result).toHaveProperty('id', 'new-id');
      expect(prisma.product.create).toHaveBeenCalledWith({
        data: { ...dto, companyId: 'company-1' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('should succeed when type=RAW_MATERIAL without NCM', async () => {
      const dto = {
        sku: 'MP-001',
        name: 'Couro Bovino',
        type: 'RAW_MATERIAL' as any,
      };

      prisma.product.findUnique.mockResolvedValue(null);
      prisma.product.create.mockResolvedValue({ id: 'new-id', ...dto });

      const result = await service.create(dto, mockUser);

      expect(result).toHaveProperty('id', 'new-id');
      expect(prisma.product.create).toHaveBeenCalledWith({
        data: { ...dto, companyId: 'company-1' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('IDOR: ignora companyId externo injetado no payload e usa o do JWT', async () => {
      // Mesmo que um atacante consiga injetar companyId no objeto,
      // o service SEMPRE persiste a empresa do usuário autenticado.
      const dto = {
        sku: 'MAL-001',
        name: 'Produto Malicioso',
        type: 'RAW_MATERIAL' as any,
        companyId: 'company-VITIMA',
      } as any;

      prisma.product.findUnique.mockResolvedValue(null);
      prisma.product.create.mockResolvedValue({ id: 'new-id' });

      await service.create(dto, mockUser);

      const createArg = prisma.product.create.mock.calls[0][0];
      expect(createArg.data.companyId).toBe('company-1');
      expect(createArg.data.companyId).not.toBe('company-VITIMA');
    });
  });

  describe('findAll (#1028)', () => {
    it('escopa por companyId e devolve o envelope paginado', async () => {
      prisma.product.count.mockResolvedValue(2);
      prisma.product.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      const res = await service.findAll('company-1', {});

      expect(prisma.product.count).toHaveBeenCalledWith({ where: { companyId: 'company-1' } });
      expect(res).toEqual({ items: [{ id: 'p1' }, { id: 'p2' }], total: 2, page: 1, pageSize: 25 });
    });

    it('aplica busca (SKU/nome), tipo e isActive como where do Prisma — nunca em memória', async () => {
      await service.findAll('company-1', { search: 'Calçado', type: 'FINISHED_GOOD' as any, isActive: 'true' });

      const where = prisma.product.findMany.mock.calls[0][0].where;
      expect(where.companyId).toBe('company-1');
      expect(where.type).toBe('FINISHED_GOOD');
      expect(where.isActive).toBe(true);
      expect(where.OR).toEqual([
        { name: { contains: 'Calçado', mode: 'insensitive' } },
        { sku: { contains: 'Calçado', mode: 'insensitive' } },
      ]);
    });

    it('usa select explícito com só os campos da listagem (sem trazer todas as colunas)', async () => {
      await service.findAll('company-1', {});

      const args = prisma.product.findMany.mock.calls[0][0];
      expect(args.select).toEqual({
        id: true,
        sku: true,
        name: true,
        type: true,
        unit: true,
        ncm: true,
        costPrice: true,
        salePrice: true,
        isActive: true,
        minStock: true,
      });
    });

    it('respeita page/pageSize e aplica desempate por id na ordenação', async () => {
      await service.findAll('company-1', { page: 2, pageSize: 10 });

      const args = prisma.product.findMany.mock.calls[0][0];
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    });
  });

  describe('exportCsv (#1032 — export server-side com cursor)', () => {
    async function drain(stream: NodeJS.ReadableStream): Promise<string> {
      const chunks: string[] = [];
      for await (const chunk of stream) chunks.push(chunk.toString());
      return chunks.join('');
    }

    it('usa EXATAMENTE o mesmo where de findAll para os mesmos filtros (search/type/isActive)', async () => {
      prisma.product.findMany
        .mockResolvedValueOnce([]) // findAll
        .mockResolvedValueOnce([]); // exportCsv (1º lote)

      const query = { search: 'Calçado', type: 'FINISHED_GOOD' as any, isActive: 'true' };
      await service.findAll('company-1', query);
      const whereFromFindAll = prisma.product.findMany.mock.calls[0][0].where;

      await drain(service.exportCsv('company-1', query));
      const whereFromExport = prisma.product.findMany.mock.calls[1][0].where;

      expect(whereFromExport).toEqual(whereFromFindAll);
    });

    it('tenancy: companyId sempre no where, mesmo sem nenhum outro filtro', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await drain(service.exportCsv('company-isolada', {}));
      expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({ companyId: 'company-isolada' });
    });

    it('usa cursor + take como chaves literais (nunca findMany aberto — list-query-lint)', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await drain(service.exportCsv('company-1', {}));
      const args = prisma.product.findMany.mock.calls[0][0];
      expect(args.take).toBeGreaterThan(0);
      expect(args.cursor).toBeUndefined(); // 1º lote sem cursor
      expect(args.orderBy).toEqual({ id: 'asc' });
    });

    it('percorre múltiplos lotes via cursor e entrega o CONJUNTO COMPLETO (não só uma página)', async () => {
      // Lote de export é CSV_EXPORT_BATCH_SIZE (500) — só fecha o 1º lote e
      // pede o próximo quando ele vem CHEIO. Simula exatamente isso: 500 no
      // 1º lote (força a 2ª chamada) + 1 no 2º (fecha, menor que o teto).
      const mk = (id: string, name: string) => ({
        id, sku: id, name, type: 'FINISHED_GOOD', unit: 'UN', ncm: null,
        costPrice: 0, salePrice: 0, isActive: true, minStock: 0,
      });
      const page1 = Array.from({ length: 500 }, (_, i) => mk(`p${i + 1}`, `Produto ${i + 1}`));
      const page2 = [mk('p501', 'Produto 501')];
      prisma.product.findMany
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      const csv = await drain(service.exportCsv('company-1', {}));

      // o último produto (do 2º lote) está no CSV — não só a "página" do 1º lote
      expect(csv).toContain('Produto 1');
      expect(csv).toContain('Produto 500');
      expect(csv).toContain('Produto 501');
      expect(prisma.product.findMany).toHaveBeenCalledTimes(2);

      // 2º lote pediu cursor = id do último item do 1º lote (nunca busca tudo de uma vez)
      expect(prisma.product.findMany.mock.calls[1][0].cursor).toEqual({ id: 'p500' });
    });

    it('nunca chama findMany sem where (proteção anti-vazamento cross-tenant)', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await drain(service.exportCsv('company-1', { search: 'x' }));
      for (const call of prisma.product.findMany.mock.calls) {
        expect(call[0].where.companyId).toBe('company-1');
      }
    });
  });

  describe('findOptions (#1028 parte 2 — combobox de formulário)', () => {
    it('escopa por companyId, sem envelope de paginação (array puro)', async () => {
      prisma.product.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      const res = await service.findOptions('company-1', {});

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'company-1' } }),
      );
      expect(res).toEqual([{ id: 'p1' }, { id: 'p2' }]);
    });

    it('aplica busca por SKU ou nome (insensível a caso) como where do Prisma', async () => {
      await service.findOptions('company-1', { search: 'calcado' });

      const args = prisma.product.findMany.mock.calls[0][0];
      expect(args.where.OR).toEqual([
        { name: { contains: 'calcado', mode: 'insensitive' } },
        { sku: { contains: 'calcado', mode: 'insensitive' } },
      ]);
    });

    it('aplica isActive só quando informado (sem filtro por padrão — mesmo comportamento de findAll)', async () => {
      await service.findOptions('company-1', {});
      expect(prisma.product.findMany.mock.calls[0][0].where.isActive).toBeUndefined();

      await service.findOptions('company-1', { isActive: 'true' });
      expect(prisma.product.findMany.mock.calls[1][0].where.isActive).toBe(true);
    });

    it('teto do take: default 50, clampa acima de 100 e ignora page/pageSize (não pagina)', async () => {
      await service.findOptions('company-1', {});
      expect(prisma.product.findMany.mock.calls[0][0].take).toBe(50);

      await service.findOptions('company-1', { take: 500 });
      expect(prisma.product.findMany.mock.calls[1][0].take).toBe(100);
    });

    it('payload enxuto: {id, sku, name} + só o que consumidores usam pra pré-preencher item (sem NCM/pesos/dados fiscais)', async () => {
      await service.findOptions('company-1', {});
      expect(prisma.product.findMany.mock.calls[0][0].select).toEqual({
        id: true,
        sku: true,
        name: true,
        salePrice: true,
        costPrice: true,
        avgCost: true,
        tracksSerial: true,
      });
    });

    it('ordenação estável (nome + desempate por id)', async () => {
      await service.findOptions('company-1', {});
      expect(prisma.product.findMany.mock.calls[0][0].orderBy).toEqual([
        { name: 'asc' },
        { id: 'asc' },
      ]);
    });
  });

  describe('update', () => {
    it('IDOR: busca escopada pela empresa do usuário (não edita produto de outro tenant)', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.update('prod-de-outra-empresa', { name: 'Hack' }, mockUser),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { id: 'prod-de-outra-empresa', companyId: 'company-1' },
      });
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('IDOR: update nunca move produto de empresa (companyId imutável)', async () => {
      const existing = {
        id: 'prod-1',
        sku: 'PROD-001',
        name: 'Produto',
        type: 'RAW_MATERIAL',
        ncm: null,
        companyId: 'company-1',
      };
      prisma.product.findFirst.mockResolvedValue(existing);
      prisma.product.update.mockResolvedValue(existing);

      // Tentativa de mover o produto para outra empresa via body
      const dto = { name: 'Novo Nome', companyId: 'company-VITIMA' } as any;

      await service.update('prod-1', dto, mockUser);

      // O data enviado ao Prisma NÃO contém companyId (imutável)
      const updateArg = prisma.product.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('companyId');
      expect(updateArg.data.name).toBe('Novo Nome');

      // AuditLog registra a empresa original, nunca a injetada
      const auditArg = prisma.auditLog.create.mock.calls[0][0];
      expect(auditArg.data.companyId).toBe('company-1');
    });
  });
});
