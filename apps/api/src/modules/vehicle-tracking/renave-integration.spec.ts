import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { RenaveOrchestratorService } from './renave-orchestrator.service';
import { VehicleProcessor } from './vehicle.processor';
import { VehicleListener } from './vehicle.listener';
import { BIN_PORT, RENAVE_PORT } from './ports/vehicle-provider.port';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { VEHICLE_QUEUE } from './renave.types';
import { sanitizeProviderResponse } from './adapters/serpro-http';

// enums via string literal (mock do @prisma/client não é fonte de verdade — padrão do repo)
const OpType = {
  BIN_REGISTER: 'BIN_REGISTER' as any,
  STOCK_IN: 'STOCK_IN' as any,
  SALE_OUT: 'SALE_OUT' as any,
  ATPVE_PDF: 'ATPVE_PDF' as any,
  CANCEL_SALE_OUT: 'CANCEL_SALE_OUT' as any,
};

const baseOp = {
  id: 'op-1',
  companyId: 'co-1',
  serialNumberId: 'sn-1',
  salesOrderId: null as string | null,
  fiscalDocumentId: null,
  fiscalDocumentChave: null as string | null,
  type: OpType.BIN_REGISTER,
  status: 'PENDING' as any,
  dedupeKey: 'BIN_REGISTER:sn-1',
  attempt: 0,
};

const baseSerial = {
  id: 'sn-1',
  chassi: '92UPRTB75TS001163',
  condicaoVeiculo: null,
  codigoMarcaModelo: '600657',
  corDenatran: null,
  qtdEixos: 2,
  anoFabricacao: 2026,
  anoModelo: 2026,
  especieVeiculo: '2',
  tipoVeiculo: '10',
  cmt: null,
  pesoBruto: null,
  product: { codigoMarcaModelo: '600657' },
};

describe('RenaveIntegration (#529-#532)', () => {
  let orchestrator: RenaveOrchestratorService;
  let processor: VehicleProcessor;
  let listener: VehicleListener;
  let prisma: any;
  let queue: { add: jest.Mock };
  let binPort: any;
  let renavePort: any;
  let emitter: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      company: { findUnique: jest.fn(), findMany: jest.fn() },
      serialNumber: { findMany: jest.fn(), findUnique: jest.fn() },
      salesOrder: { findUnique: jest.fn() },
      fiscalDocument: { findFirst: jest.fn() },
      renaveOperation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      binRegistration: { upsert: jest.fn() },
      atpveRecord: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    queue = { add: jest.fn() };
    binPort = { registerVehicle: jest.fn() };
    renavePort = {
      entrarEstoque: jest.fn(),
      sairEstoque: jest.fn(),
      obterPdfAtpv: jest.fn(),
      cancelarSaida: jest.fn(),
      devolverMontadora: jest.fn(),
    };
    emitter = { emit: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        RenaveOrchestratorService,
        VehicleProcessor,
        VehicleListener,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
        { provide: getQueueToken(VEHICLE_QUEUE), useValue: queue },
        { provide: BIN_PORT, useValue: binPort },
        { provide: RENAVE_PORT, useValue: renavePort },
        { provide: MailService, useValue: { send: jest.fn().mockResolvedValue({ ok: true }) } },
      ],
    }).compile();

    orchestrator = module.get(RenaveOrchestratorService);
    processor = module.get(VehicleProcessor);
    listener = module.get(VehicleListener);
  });

  describe('feature flag (#532)', () => {
    it('startSaleFlow é no-op com renaveEnabled=false', async () => {
      prisma.company.findUnique.mockResolvedValue({ renaveEnabled: false });
      await orchestrator.startSaleFlow('co-1', 'ov-1', 'fd-1', 'chave');
      expect(prisma.serialNumber.findMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('startSaleFlow enfileira BIN_REGISTER por chassi com flag ligada', async () => {
      prisma.company.findUnique.mockResolvedValue({ renaveEnabled: true });
      prisma.serialNumber.findMany.mockResolvedValue([{ id: 'sn-1', chassi: 'X' }]);
      prisma.renaveOperation.findUnique.mockResolvedValue(null);
      prisma.renaveOperation.create.mockResolvedValue({ ...baseOp });
      await orchestrator.startSaleFlow('co-1', 'ov-1', 'fd-1', 'chave44');
      expect(prisma.renaveOperation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dedupeKey: 'BIN_REGISTER:sn-1' }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'bin-register',
        { operationId: 'op-1' },
        expect.objectContaining({ attempts: 5 }),
      );
    });
  });

  describe('idempotência via dedupeKey (#527)', () => {
    it('operação já concluída não re-enfileira', async () => {
      prisma.renaveOperation.findUnique.mockResolvedValue({
        ...baseOp,
        status: 'REGISTERED',
      });
      const result = await orchestrator.ensureOperation({
        companyId: 'co-1',
        type: OpType.BIN_REGISTER,
        serialNumberId: 'sn-1',
      });
      expect(result).toBeNull();
      expect(queue.add).not.toHaveBeenCalled();
      expect(prisma.renaveOperation.create).not.toHaveBeenCalled();
    });

    it('operação em ERROR re-enfileira sem duplicar registro', async () => {
      prisma.renaveOperation.findUnique.mockResolvedValue({ ...baseOp, status: 'ERROR' });
      await orchestrator.ensureOperation({
        companyId: 'co-1',
        type: OpType.BIN_REGISTER,
        serialNumberId: 'sn-1',
      });
      expect(prisma.renaveOperation.create).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalled();
    });
  });

  describe('processor (#529/#532)', () => {
    const job = { id: 1, data: { operationId: 'op-1' } } as any;

    it('sucesso do provider marca REGISTERED, projeta BinRegistration e emite evento', async () => {
      prisma.renaveOperation.findUnique.mockResolvedValue({ ...baseOp });
      prisma.serialNumber.findUnique.mockResolvedValue({ ...baseSerial });
      prisma.company.findUnique.mockResolvedValue({ state: 'PR' });
      prisma.renaveOperation.update.mockResolvedValue({});
      binPort.registerVehicle.mockResolvedValue({ status: 'ok', protocol: 'P123', raw: {} });

      await processor.handleBinRegister(job);

      expect(prisma.renaveOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REGISTERED' }) }),
      );
      expect(prisma.binRegistration.upsert).toHaveBeenCalled();
      expect(emitter.emit).toHaveBeenCalledWith(
        'vehicle.bin.registered',
        expect.objectContaining({ serialNumberId: 'sn-1' }),
      );
    });

    it('erro do provider marca ERROR e relança p/ retry do Bull', async () => {
      prisma.renaveOperation.findUnique.mockResolvedValue({ ...baseOp });
      prisma.serialNumber.findUnique.mockResolvedValue({ ...baseSerial });
      prisma.company.findUnique.mockResolvedValue({ state: 'PR' });
      prisma.renaveOperation.update.mockResolvedValue({});
      binPort.registerVehicle.mockResolvedValue({ status: 'erro', motivo: 'timeout' });

      await expect(processor.handleBinRegister(job)).rejects.toThrow('timeout');
      expect(prisma.renaveOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ERROR', lastError: 'timeout' }),
        }),
      );
    });

    it('replay de job sobre operação concluída é no-op (idempotência)', async () => {
      prisma.renaveOperation.findUnique.mockResolvedValue({ ...baseOp, status: 'REGISTERED' });
      await processor.handleBinRegister(job);
      expect(binPort.registerVehicle).not.toHaveBeenCalled();
    });

    it('SALE_OUT sem chave de NF-e falha com mensagem orientada', async () => {
      prisma.renaveOperation.findUnique.mockResolvedValue({
        ...baseOp,
        type: OpType.SALE_OUT,
        salesOrderId: 'ov-1',
        fiscalDocumentChave: null,
      });
      prisma.serialNumber.findUnique.mockResolvedValue({ ...baseSerial });
      prisma.renaveOperation.update.mockResolvedValue({});
      await expect(processor.handleSaleOut(job)).rejects.toThrow(/chave/i);
    });
  });

  describe('cadeia SALE_OUT → ATPV-e (#530)', () => {
    it('completeOperation de SALE_OUT cria AtpveRecord e enfileira ATPVE_PDF', async () => {
      const op = {
        ...baseOp,
        type: OpType.SALE_OUT,
        salesOrderId: 'ov-1',
        fiscalDocumentChave: '1'.repeat(44),
      };
      prisma.salesOrder.findUnique.mockResolvedValue({
        customer: { name: 'Cliente', razaoSocial: null, document: '12345678900' },
      });
      prisma.atpveRecord.findFirst.mockResolvedValue(null);
      prisma.renaveOperation.update.mockResolvedValue({});
      prisma.renaveOperation.findUnique.mockResolvedValue(null);
      prisma.renaveOperation.create.mockResolvedValue({ ...op, id: 'op-2', type: OpType.ATPVE_PDF });

      await orchestrator.completeOperation(op as any, { protocol: 'IV-9' });

      expect(prisma.atpveRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ clienteCpf: '12345678900', atpveNumber: 'IV-9' }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'atpv-pdf',
        { operationId: 'op-2' },
        expect.anything(),
      );
    });

    it('completeOperation de ATPVE_PDF persiste binário e agenda e-mail', async () => {
      const op = { ...baseOp, type: OpType.ATPVE_PDF, salesOrderId: 'ov-1' };
      prisma.renaveOperation.update.mockResolvedValue({});
      await orchestrator.completeOperation(op as any, {
        pdfBase64: Buffer.from('pdf').toString('base64'),
      });
      expect(prisma.atpveRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ISSUED' }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'atpv-email',
        { operationId: 'op-1' },
        expect.anything(),
      );
    });
  });

  describe('devolução (#531)', () => {
    it('cancelSaleFlow cria CANCEL_SALE_OUT só p/ chassi com intenção de venda', async () => {
      prisma.company.findUnique.mockResolvedValue({ renaveEnabled: true });
      prisma.renaveOperation.findMany.mockResolvedValue([{ serialNumberId: 'sn-1' }]);
      prisma.renaveOperation.findUnique.mockResolvedValue(null);
      prisma.renaveOperation.create.mockResolvedValue({
        ...baseOp,
        id: 'op-3',
        type: OpType.CANCEL_SALE_OUT,
        salesOrderId: 'ov-1',
      });
      await orchestrator.cancelSaleFlow('co-1', 'ov-1');
      expect(prisma.renaveOperation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dedupeKey: 'CANCEL_SALE_OUT:sn-1:ov-1' }),
        }),
      );
    });

    it('returnToManufacturer valida chave de 44 dígitos', async () => {
      await expect(
        orchestrator.returnToManufacturer('co-1', 'ov-1', 'sn-1', '123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('retry manual (#532)', () => {
    it('só re-enfileira operação em ERROR', async () => {
      prisma.renaveOperation.findFirst.mockResolvedValue({ ...baseOp, status: 'PROCESSING' });
      await expect(orchestrator.retry('op-1', 'co-1')).rejects.toThrow(BadRequestException);

      prisma.renaveOperation.findFirst.mockResolvedValue({ ...baseOp, status: 'ERROR' });
      await orchestrator.retry('op-1', 'co-1');
      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('listener nunca lança (#532 — falha externa não desfaz venda)', () => {
    it('onFiscalAuthorized engole exceção e loga', async () => {
      prisma.salesOrder.findUnique.mockRejectedValue(new Error('db down'));
      await expect(
        listener.onFiscalAuthorized({
          companyId: 'co-1',
          fiscalDocumentId: 'fd-1',
          salesOrderId: 'ov-1',
          storeTransferId: null,
          chave: null,
        } as any),
      ).resolves.toBeUndefined();
    });

    it('OV RETURNED com NF-e (devolução) autorizada dispara cancelamento, não venda', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue({ status: 'RETURNED' });
      const cancelSpy = jest.spyOn(orchestrator, 'cancelSaleFlow').mockResolvedValue();
      const saleSpy = jest.spyOn(orchestrator, 'startSaleFlow').mockResolvedValue();
      await listener.onFiscalAuthorized({
        companyId: 'co-1',
        fiscalDocumentId: 'fd-1',
        salesOrderId: 'ov-1',
        storeTransferId: null,
        chave: null,
      } as any);
      expect(cancelSpy).toHaveBeenCalledWith('co-1', 'ov-1');
      expect(saleSpy).not.toHaveBeenCalled();
    });
  });

  describe('sanitização LGPD (#527)', () => {
    it('mascara cpf/cnpj/token aninhados no retorno do provider', () => {
      const out = sanitizeProviderResponse({
        protocolo: 'P1',
        cpfComprador: '123',
        dados: { cnpj: '456', ok: true },
        authorization: 'Bearer x',
      });
      expect(out).toEqual({
        protocolo: 'P1',
        cpfComprador: '[REDACTED]',
        dados: { cnpj: '[REDACTED]', ok: true },
        authorization: '[REDACTED]',
      });
    });
  });
});
