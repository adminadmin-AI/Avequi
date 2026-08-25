import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ManifestService, MANIFEST_CONFIRMED_EVENT } from './manifest.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EMISSOR_PORT } from '../fiscal/emissor.port';

describe('ManifestService', () => {
  let service: ManifestService;
  let prisma: any;
  let fiscalClient: any;
  let eventEmitter: any;

  const mockCompany = {
    id: 'comp-1',
    cnpj: '12.345.678/0001-90',
    name: 'GDR Reboques',
  };

  const mockManifest = {
    id: 'manifest-1',
    companyId: 'comp-1',
    chaveNfe: '35260612345678000190550010000000011000000011',
    nfeNumber: '1',
    series: '1',
    supplierCnpj: '98765432000199',
    supplierName: 'Fornecedor Teste',
    issueDate: new Date('2026-06-01'),
    totalValue: 1500.0,
    status: 'PENDING',
    lastEventType: null,
    lastEventDate: null,
    justification: null,
    protocol: null,
    inboundNfeId: null,
    manifestedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      company: { findUnique: jest.fn() },
      nfeManifest: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn(),
        count: jest.fn(),
      },
      systemParameter: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn() },
    };

    fiscalClient = {
      fetchReceivedNfes: jest.fn(),
      fetchReceivedNfesPage: jest.fn(),
      manifestNfe: jest.fn(),
    };

    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ManifestService,
        { provide: PrismaService, useValue: prisma },
        { provide: EMISSOR_PORT, useValue: fiscalClient },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<ManifestService>(ManifestService);
  });

  describe('syncReceivedNfes (Focus-A: incremental, cursor em SystemParameter)', () => {
    const KEY = 'focus.nfe_recebidas.sync:12345678000190';
    const item = (chave: string, versao: number) => ({
      chave_nfe: chave, versao, numero: '1', serie: '1', cnpj_emitente: '98765432000199',
      nome_emitente: 'Fornecedor Teste', data_emissao: '2026-06-01', valor_total: 1500.0,
    });
    const CH1 = '35260612345678000190550010000000011000000011';
    const CH2 = '35260612345678000190550010000000021000000022';

    it('primeira execução: busca a partir de versao=0, cria os novos e persiste o cursor', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      prisma.systemParameter.findUnique.mockResolvedValue(null);
      fiscalClient.fetchReceivedNfesPage.mockResolvedValueOnce({ items: [item(CH1, 10), item(CH2, 12)], maxVersion: 12, totalCount: 2 });
      prisma.nfeManifest.findUnique.mockResolvedValue(null);

      const result = await service.syncReceivedNfes('comp-1');

      expect(fiscalClient.fetchReceivedNfesPage).toHaveBeenCalledWith('12345678000190', 0, 'comp-1');
      expect(result).toMatchObject({ synced: 2, total: 2, cursorFrom: 0, cursorTo: 12, pages: 1 });
      expect(prisma.nfeManifest.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.nfeManifest.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { companyId_chaveNfe: { companyId: 'comp-1', chaveNfe: CH1 } },
        create: expect.objectContaining({ companyId: 'comp-1', chaveNfe: CH1, supplierCnpj: '98765432000199', status: 'PENDING' }),
      }));
      const last = prisma.systemParameter.upsert.mock.calls.at(-1)[0];
      expect(last.where).toEqual({ companyId_key: { companyId: 'comp-1', key: KEY } });
      expect(JSON.parse(last.update.value)).toMatchObject({ cursor: 12, lastRunStatus: 'OK', lastRunNew: 2, lastRunSeen: 2 });
    });

    it('já sincronizada → não recria (idempotente) e o cursor avança mesmo assim', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      prisma.systemParameter.findUnique.mockResolvedValue({ value: JSON.stringify({ cursor: 5 }) });
      fiscalClient.fetchReceivedNfesPage.mockResolvedValueOnce({ items: [item(CH1, 10)], maxVersion: 10, totalCount: 1 });
      prisma.nfeManifest.findUnique.mockResolvedValue(mockManifest);

      const result = await service.syncReceivedNfes('comp-1');

      expect(fiscalClient.fetchReceivedNfesPage).toHaveBeenCalledWith('12345678000190', 5, 'comp-1');
      expect(result).toMatchObject({ synced: 0, total: 1, cursorFrom: 5, cursorTo: 10 });
      expect(prisma.nfeManifest.upsert).not.toHaveBeenCalled();
    });

    it('falha da Focus LANÇA (não vira 0 notas) e grava estado FAILED sem mover o cursor', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      prisma.systemParameter.findUnique.mockResolvedValue({ value: JSON.stringify({ cursor: 7 }) });
      fiscalClient.fetchReceivedNfesPage.mockRejectedValueOnce(new Error('HTTP 503'));

      await expect(service.syncReceivedNfes('comp-1')).rejects.toThrow('HTTP 503');
      const last = prisma.systemParameter.upsert.mock.calls.at(-1)[0];
      expect(JSON.parse(last.update.value)).toMatchObject({ cursor: 7, lastRunStatus: 'FAILED', lastError: 'HTTP 503' });
    });

    it('getSyncState devolve o estado persistido (ou inicial)', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      prisma.systemParameter.findUnique.mockResolvedValue(null);
      expect(await service.getSyncState('comp-1')).toMatchObject({ cnpj: '12345678000190', cursor: 0, lastRunStatus: 'NEVER' });
    });

    it('item real da Focus (documento_emitente, sem numero/serie) grava supplierCnpj e número/série derivados da chave', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      prisma.systemParameter.findUnique.mockResolvedValue(null);
      fiscalClient.fetchReceivedNfesPage.mockResolvedValueOnce({
        items: [{ chave_nfe: CH1, versao: 3, documento_emitente: '98765432000199', nome_emitente: 'Fornecedor Teste', valor_total: '1500.00', situacao: 'autorizada', manifestacao_destinatario: 'nulo', nfe_completa: false }],
        maxVersion: 3, totalCount: 1,
      });
      prisma.nfeManifest.findUnique.mockResolvedValue(null);
      await service.syncReceivedNfes('comp-1');
      expect(prisma.nfeManifest.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ supplierCnpj: '98765432000199', nfeNumber: '1', series: '1' }),
      }));
    });

    it('nota de outro CNPJ na resposta ⇒ lança, nada persistido, estado FAILED', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      prisma.systemParameter.findUnique.mockResolvedValue(null);
      fiscalClient.fetchReceivedNfesPage.mockResolvedValueOnce({
        items: [{ ...item(CH1, 3), cnpj_destinatario: '99999999000199' }], maxVersion: 3, totalCount: 1,
      });
      await expect(service.syncReceivedNfes('comp-1')).rejects.toThrow('destinada ao CNPJ 99999999000199');
      expect(prisma.nfeManifest.upsert).not.toHaveBeenCalled();
      const last = prisma.systemParameter.upsert.mock.calls.at(-1)[0];
      expect(JSON.parse(last.update.value)).toMatchObject({ cursor: 0, lastRunStatus: 'FAILED' });
    });

    it('unique violation (P2002) no NfeManifest não derruba a execução: conta como já existente', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      prisma.systemParameter.findUnique.mockResolvedValue(null);
      fiscalClient.fetchReceivedNfesPage.mockResolvedValueOnce({ items: [item(CH1, 10), item(CH2, 12)], maxVersion: 12, totalCount: 2 });
      prisma.nfeManifest.findUnique.mockResolvedValue(null);
      prisma.nfeManifest.upsert.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
      const r = await service.syncReceivedNfes('comp-1');
      expect(r).toMatchObject({ synced: 1, total: 2, cursorTo: 12 });
    });
  });

  describe('syncReceivedNfes — exclusão mútua por company (cron × POST manual)', () => {
    const KEY = 'focus.nfe_recebidas.sync:12345678000190';
    const CH1 = '35260612345678000190550010000000011000000011';
    const item = (chave: string, versao: number) => ({ chave_nfe: chave, versao, documento_emitente: '98765432000199', nome_emitente: 'F', valor_total: '1.00' });

    /** Simula a linha gdr_system_parameters de verdade: compare-and-swap no valor. */
    function fakeParamRow() {
      const row: { value: string | null; updatedAt: Date } = { value: null, updatedAt: new Date(0) };
      prisma.systemParameter.findUnique.mockImplementation(async () => (row.value === null ? null : { companyId: 'comp-1', key: KEY, value: row.value, updatedAt: row.updatedAt }));
      prisma.systemParameter.updateMany.mockImplementation(async ({ where, data }: any) => {
        if (row.value !== where.value) return { count: 0 };
        row.value = data.value; row.updatedAt = new Date();
        return { count: 1 };
      });
      prisma.systemParameter.create.mockImplementation(async ({ data }: any) => {
        if (row.value !== null) throw Object.assign(new Error('Unique'), { code: 'P2002' });
        row.value = data.value; row.updatedAt = new Date();
        return {};
      });
      prisma.systemParameter.upsert.mockImplementation(async ({ update }: any) => { row.value = update.value; row.updatedAt = new Date(); return {}; });
      return row;
    }

    it('cron e POST simultâneos na mesma company: só um executa; o outro recebe 409 e não toca cursor nem NfeManifest', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      const row = fakeParamRow();
      prisma.nfeManifest.findUnique.mockResolvedValue(null);
      let release!: () => void;
      const gate = new Promise<void>((res) => { release = res; });
      fiscalClient.fetchReceivedNfesPage.mockImplementation(async () => { await gate; return { items: [item(CH1, 10)], maxVersion: 10, totalCount: 1 }; });

      const a = service.syncReceivedNfes('comp-1'); // "cron"
      const b = service.syncReceivedNfes('comp-1'); // "POST manual", enquanto a ainda roda
      await expect(b).rejects.toBeInstanceOf(ConflictException);
      release();
      await expect(a).resolves.toMatchObject({ synced: 1, cursorTo: 10 });
      expect(fiscalClient.fetchReceivedNfesPage).toHaveBeenCalledTimes(1);
      expect(prisma.nfeManifest.upsert).toHaveBeenCalledTimes(1);
      expect(JSON.parse(row.value!)).toMatchObject({ cursor: 10, lastRunStatus: 'OK' });

      // depois que a primeira terminou, a mesma company pode sincronizar de novo
      fiscalClient.fetchReceivedNfesPage.mockResolvedValueOnce({ items: [], maxVersion: null, totalCount: 0 });
      await expect(service.syncReceivedNfes('comp-1')).resolves.toMatchObject({ synced: 0, cursorFrom: 10, cursorTo: 10 });
    });

    it('lease RUNNING recente em OUTRA instância (só no banco) ⇒ 409; RUNNING vencido (processo morto) ⇒ assume e retoma do cursor', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      const row = fakeParamRow();
      row.value = JSON.stringify({ cursor: 40, lastRunStatus: 'RUNNING', lastSyncAt: '2026-08-25T10:00:00Z' });
      row.updatedAt = new Date(); // acabou de ser tocado por outro processo
      await expect(service.syncReceivedNfes('comp-1')).rejects.toBeInstanceOf(ConflictException);
      expect(fiscalClient.fetchReceivedNfesPage).not.toHaveBeenCalled();

      row.updatedAt = new Date(Date.now() - 31 * 60 * 1000); // lease vencido
      fiscalClient.fetchReceivedNfesPage.mockResolvedValueOnce({ items: [], maxVersion: null, totalCount: 0 });
      await expect(service.syncReceivedNfes('comp-1')).resolves.toMatchObject({ cursorFrom: 40, cursorTo: 40 });
    });

    it('compare-and-swap perdido (outra instância mudou o estado entre a leitura e a escrita) ⇒ 409, nada executado', async () => {
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      prisma.systemParameter.findUnique.mockResolvedValue({ value: JSON.stringify({ cursor: 5, lastRunStatus: 'OK' }), updatedAt: new Date() });
      prisma.systemParameter.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.syncReceivedNfes('comp-1')).rejects.toBeInstanceOf(ConflictException);
      expect(fiscalClient.fetchReceivedNfesPage).not.toHaveBeenCalled();
      expect(prisma.systemParameter.upsert).not.toHaveBeenCalled();
    });

    it('companies diferentes não se bloqueiam', async () => {
      prisma.company.findUnique.mockImplementation(async ({ where }: any) => ({ id: where.id, cnpj: where.id === 'comp-1' ? '12345678000190' : '30284708000182', name: where.id }));
      prisma.systemParameter.findUnique.mockResolvedValue(null);
      prisma.nfeManifest.findUnique.mockResolvedValue(null);
      let release!: () => void;
      const gate = new Promise<void>((res) => { release = res; });
      fiscalClient.fetchReceivedNfesPage.mockImplementation(async () => { await gate; return { items: [], maxVersion: null, totalCount: 0 }; });
      const a = service.syncReceivedNfes('comp-1');
      const b = service.syncReceivedNfes('comp-2');
      release();
      await expect(Promise.all([a, b])).resolves.toHaveLength(2);
      expect(fiscalClient.fetchReceivedNfesPage).toHaveBeenCalledTimes(2);
    });
  });

  describe('registerCiencia', () => {
    it('should register ciência for PENDING manifest', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue(mockManifest);
      fiscalClient.manifestNfe.mockResolvedValue({ status: 'autorizado', protocolo: 'PROT123' });
      prisma.nfeManifest.update.mockResolvedValue({ ...mockManifest, status: 'CIENCIA' });

      await service.registerCiencia(mockManifest.chaveNfe, 'comp-1', 'user-1');

      expect(fiscalClient.manifestNfe).toHaveBeenCalledWith(mockManifest.chaveNfe, 210210, undefined, 'comp-1');
      expect(prisma.nfeManifest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CIENCIA',
            lastEventType: 'CIENCIA',
            protocol: 'PROT123',
          }),
        }),
      );
    });

    it('should reject ciência for non-PENDING manifest', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue({ ...mockManifest, status: 'CONFIRMED' });

      await expect(
        service.registerCiencia(mockManifest.chaveNfe, 'comp-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirmOperation', () => {
    it('should confirm operation and emit event', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue({ ...mockManifest, status: 'CIENCIA' });
      fiscalClient.manifestNfe.mockResolvedValue({ status: 'autorizado', protocolo: 'PROT456' });
      prisma.nfeManifest.update.mockResolvedValue({ ...mockManifest, status: 'CONFIRMED' });

      await service.confirmOperation(mockManifest.chaveNfe, 'comp-1', 'user-1');

      expect(fiscalClient.manifestNfe).toHaveBeenCalledWith(mockManifest.chaveNfe, 210200, undefined, 'comp-1');
      expect(prisma.nfeManifest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CONFIRMED',
            lastEventType: 'CONFIRMACAO',
          }),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MANIFEST_CONFIRMED_EVENT,
        expect.objectContaining({
          companyId: 'comp-1',
          chaveNfe: mockManifest.chaveNfe,
        }),
      );
    });

    it('should allow confirming from PENDING directly', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue(mockManifest); // PENDING
      fiscalClient.manifestNfe.mockResolvedValue({ status: 'autorizado' });
      prisma.nfeManifest.update.mockResolvedValue({ ...mockManifest, status: 'CONFIRMED' });

      await service.confirmOperation(mockManifest.chaveNfe, 'comp-1', 'user-1');

      expect(prisma.nfeManifest.update).toHaveBeenCalled();
    });
  });

  describe('rejectOperation', () => {
    it('should reject operation with justification', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue(mockManifest);
      fiscalClient.manifestNfe.mockResolvedValue({ status: 'autorizado', protocolo: 'PROT789' });
      prisma.nfeManifest.update.mockResolvedValue({ ...mockManifest, status: 'NOT_PERFORMED' });

      await service.rejectOperation(
        mockManifest.chaveNfe,
        'comp-1',
        'user-1',
        'Mercadoria não foi recebida pela empresa',
      );

      expect(fiscalClient.manifestNfe).toHaveBeenCalledWith(
        mockManifest.chaveNfe,
        210220,
        'Mercadoria não foi recebida pela empresa',
  'comp-1',
      );
      expect(prisma.nfeManifest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'NOT_PERFORMED',
            justification: 'Mercadoria não foi recebida pela empresa',
          }),
        }),
      );
    });
  });

  describe('unknownOperation', () => {
    it('should register desconhecimento', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue(mockManifest);
      fiscalClient.manifestNfe.mockResolvedValue({ status: 'autorizado' });
      prisma.nfeManifest.update.mockResolvedValue({ ...mockManifest, status: 'UNKNOWN' });

      await service.unknownOperation(
        mockManifest.chaveNfe,
        'comp-1',
        'user-1',
        'Não conheço este fornecedor nem operação',
      );

      expect(fiscalClient.manifestNfe).toHaveBeenCalledWith(
        mockManifest.chaveNfe,
        210240,
        'Não conheço este fornecedor nem operação',
  'comp-1',
      );
    });

    it('should not allow desconhecimento on confirmed NF-e', async () => {
      prisma.nfeManifest.findUnique.mockResolvedValue({ ...mockManifest, status: 'CONFIRMED' });

      await expect(
        service.unknownOperation(mockManifest.chaveNfe, 'comp-1', 'user-1', 'justificativa teste longa suficiente'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findPending', () => {
    it('should return pending manifests', async () => {
      prisma.nfeManifest.findMany.mockResolvedValue([mockManifest]);

      const result = await service.findPending('comp-1');

      expect(result).toHaveLength(1);
      expect(prisma.nfeManifest.findMany).toHaveBeenCalledWith({
        where: { companyId: 'comp-1', status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOverdue', () => {
    it('should return manifests older than 30 days', async () => {
      const oldManifest = {
        ...mockManifest,
        createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
      };
      prisma.nfeManifest.findMany.mockResolvedValue([oldManifest]);

      const result = await service.findOverdue('comp-1');

      expect(result).toHaveLength(1);
      expect(prisma.nfeManifest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'comp-1',
            status: 'PENDING',
            createdAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
        }),
      );
    });
  });

  describe('getStats', () => {
    it('should return aggregated stats', async () => {
      prisma.nfeManifest.count
        .mockResolvedValueOnce(5)  // pending
        .mockResolvedValueOnce(3)  // ciencia
        .mockResolvedValueOnce(10) // confirmed
        .mockResolvedValueOnce(1)  // notPerformed
        .mockResolvedValueOnce(0)  // unknown
        .mockResolvedValueOnce(2); // overdue

      const stats = await service.getStats('comp-1');

      expect(stats).toEqual({
        pending: 5,
        ciencia: 3,
        confirmed: 10,
        notPerformed: 1,
        unknown: 0,
        overdue: 2,
      });
    });
  });
});
