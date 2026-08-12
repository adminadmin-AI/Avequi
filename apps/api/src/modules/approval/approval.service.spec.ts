import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ApprovalService } from './approval.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../iam/permission.service';

const mockPrisma = {
  approvalMatrix: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  purchaseOrder: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  purchaseRequest: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn(), findMany: jest.fn() },
  role: { findMany: jest.fn() },
};

// SOD_ENFORCE lido via ConfigService — default (env ausente) = OFF.
const mockConfig = { get: jest.fn() };

// #1005: os perfis v2 de quem opera vêm do PermissionService (codes diretos).
const mockPermissions = { getUserPermissions: jest.fn() };

/** O usuário do teste tem estes perfis v2 (codes). */
function perfisDoUsuario(...codes: string[]) {
  mockPermissions.getUserPermissions.mockResolvedValue({ roles: codes, permissions: [] });
}

// Catálogo mínimo para lookups de nome/validação de code.
const ROLES_ATIVOS = [
  { id: 'r-gg', code: 'GERENTE_GERAL', name: 'Gerente Geral' },
  { id: 'r-dir', code: 'DIRETOR', name: 'Diretor' },
  { id: 'r-adm', code: 'ADMIN_GLOBAL', name: 'Admin Global' },
  { id: 'r-alm', code: 'ALMOXARIFE', name: 'Almoxarife' },
];

describe('ApprovalService', () => {
  let service: ApprovalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: PermissionService, useValue: mockPermissions },
      ],
    }).compile();
    service = module.get<ApprovalService>(ApprovalService);
    jest.clearAllMocks();
    // Default: flag ausente/OFF (comportamento padrão da empresa)
    mockConfig.get.mockReturnValue(undefined);
    perfisDoUsuario(); // default: usuário sem perfil v2
    mockPrisma.role.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(ROLES_ATIVOS.filter((r) => (where.code?.in ?? []).includes(r.code))),
    );
  });

  describe('approve (#1005 — matriz por perfil v2)', () => {
    it('PO R$3k → GERENTE_GERAL aprova direto (nível único)', async () => {
      perfisDoUsuario('GERENTE_GERAL');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 10, unitCost: 300 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { level: 1, conditionField: 'amount', conditionOp: 'lte', conditionValue: '5000', approverRoles: ['GERENTE_GERAL', 'DIRETOR', 'ADMIN_GLOBAL'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-1', 'PO', 'co-1', 'user-1');
      expect(result.status).toBe('APPROVED');
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }),
      );
    });

    it('PO R$20k → GERENTE_GERAL aprova nível 1, pendente DIRETOR nível 2', async () => {
      perfisDoUsuario('GERENTE_GERAL');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-2', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 100, unitCost: 200 }], // R$20k
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { level: 1, conditionField: 'amount', conditionOp: 'gte', conditionValue: '5000', approverRoles: ['GERENTE_GERAL', 'DIRETOR', 'ADMIN_GLOBAL'] },
        { level: 2, conditionField: 'amount', conditionOp: 'gte', conditionValue: '5000', approverRoles: ['DIRETOR', 'ADMIN_GLOBAL'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.approve('po-2', 'PO', 'co-1', 'user-1');
      expect(result.status).toBe('PENDING_NEXT_LEVEL');
      expect(result.remainingLevels).toHaveLength(1);
      expect(result.remainingLevels[0].level).toBe(2);
    });

    it('perfil fora dos approverRoles do nível → ForbiddenException com os NOMES dos perfis', async () => {
      perfisDoUsuario('ALMOXARIFE');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-3', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['GERENTE_GERAL', 'DIRETOR'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await expect(
        service.approve('po-3', 'PO', 'co-1', 'user-1'),
      ).rejects.toThrow(/exige um destes perfis: Gerente Geral, Diretor/);
    });

    it('com MAIS de um perfil v2, basta um deles casar com o nível', async () => {
      perfisDoUsuario('ALMOXARIFE', 'GERENTE_GERAL');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-4', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['GERENTE_GERAL'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-4', 'PO', 'co-1', 'user-1');
      expect(result.status).toBe('APPROVED');
    });

    it('usuário sem NENHUM perfil v2 não casa com nível de matriz (sem fallback de enum)', async () => {
      perfisDoUsuario();
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-5', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['GERENTE_GERAL'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await expect(
        service.approve('po-5', 'PO', 'co-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a trilha LEVEL_APPROVE registra os PERFIS v2 de quem aprovou', async () => {
      perfisDoUsuario('GERENTE_GERAL');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-6', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['GERENTE_GERAL'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      await service.approve('po-6', 'PO', 'co-1', 'user-1');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payload: expect.objectContaining({ roles: ['GERENTE_GERAL'] }),
          }),
        }),
      );
    });

    it('deriva de estado (matriz editada após aprovações): FINALIZA em vez de travar', async () => {
      // A trilha diz que todos os níveis exigidos já foram aprovados, mas o
      // documento segue DRAFT (a matriz foi renumerada no meio do fluxo).
      // Antes: 400 "todas já concedidas" e o documento ficava preso.
      perfisDoUsuario('DIRETOR');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-drift', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['GERENTE_GERAL'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { userId: 'outro', payload: { documentId: 'po-drift', level: 1 } },
      ]);
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-drift', 'PO', 'co-1', 'user-1');
      expect(result.status).toBe('APPROVED');
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalled();
    });

    // ── #948-C1: o portão global por enum saiu; a matriz continua mandando ──

    it('#948-C1: sem matriz, quem tem a permissão aprova — e nem resolve perfis', async () => {
      // O gate da rota (approvals.requests.approve) já passou. Sem matriz não
      // há nível a casar, então os perfis v2 nem são consultados.
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-c1', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([]); // sem matriz
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      await expect(service.approve('po-c1', 'PO', 'co-1', 'user-1')).resolves.toBeDefined();
      expect(mockPermissions.getUserPermissions).not.toHaveBeenCalled();
    });

    it('#948-C1: COM matriz, a alçada continua podendo NEGAR — nada foi afrouxado', async () => {
      perfisDoUsuario('ALMOXARIFE');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-c2', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['DIRETOR'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await expect(
        service.approve('po-c2', 'PO', 'co-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('#948-C1/#1005: nem o portão global nem o enum legado existem no código', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const src: string = require('fs').readFileSync(
        'src/modules/approval/approval.service.ts',
        'utf-8',
      );
      expect(src).not.toMatch(/\['SUPER_ADMIN', 'DIRECTOR', 'MANAGER'\]/);
      expect(src).toMatch(/approverRoles/); // a matriz continua lá
      // #1005: o service não recebe mais o enum do controller
      expect(src).not.toMatch(/userRole: string/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Matriz de alçadas — CRUD (#1005)
  // ────────────────────────────────────────────────────────────────────────
  describe('matriz (CRUD, #1005)', () => {
    it('createMatrix valida os codes contra perfis ativos e grava a condição normalizada', async () => {
      mockPrisma.approvalMatrix.create.mockResolvedValue({ id: 'am-1' });
      await service.createMatrix('co-1', {
        entityType: 'PO',
        level: 1,
        conditionOp: 'gte',
        conditionValue: 5000,
        approverRoles: ['GERENTE_GERAL', 'DIRETOR'],
      });
      expect(mockPrisma.approvalMatrix.create).toHaveBeenCalledWith({
        data: {
          companyId: 'co-1',
          entityType: 'PO',
          level: 1,
          approverRoles: ['GERENTE_GERAL', 'DIRETOR'],
          conditionField: 'amount',
          conditionOp: 'gte',
          conditionValue: '5000',
        },
      });
    });

    it('code desconhecido/inativo é recusado com a lista do que não existe', async () => {
      await expect(
        service.createMatrix('co-1', {
          entityType: 'PO',
          level: 1,
          approverRoles: ['GERENTE_GERAL', 'COMMERCIAL'],
        }),
      ).rejects.toThrow(/Perfil não encontrado ou inativo: COMMERCIAL/);
      expect(mockPrisma.approvalMatrix.create).not.toHaveBeenCalled();
    });

    it('operador sem valor (e vice-versa) é pedido malformado', async () => {
      await expect(
        service.createMatrix('co-1', {
          entityType: 'PO',
          level: 1,
          conditionOp: 'gte',
          approverRoles: ['DIRETOR'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('sem condição, o nível vale para qualquer valor (campos null)', async () => {
      mockPrisma.approvalMatrix.create.mockResolvedValue({ id: 'am-2' });
      await service.createMatrix('co-1', {
        entityType: 'PR',
        level: 1,
        approverRoles: ['DIRETOR'],
      });
      expect(mockPrisma.approvalMatrix.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conditionField: null,
          conditionOp: null,
          conditionValue: null,
        }),
      });
    });

    it('updateMatrix é isolado por empresa (linha de outro tenant = 404)', async () => {
      mockPrisma.approvalMatrix.findFirst.mockResolvedValue(null);
      await expect(
        service.updateMatrix('am-alheio', 'co-1', { level: 2 }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.approvalMatrix.update).not.toHaveBeenCalled();
    });

    it('updateMatrix com conditionOp null LIMPA a condição', async () => {
      mockPrisma.approvalMatrix.findFirst.mockResolvedValue({
        id: 'am-3', companyId: 'co-1',
        conditionField: 'amount', conditionOp: 'gte', conditionValue: '5000',
      });
      mockPrisma.approvalMatrix.update.mockResolvedValue({});
      await service.updateMatrix('am-3', 'co-1', { conditionOp: null as any });
      expect(mockPrisma.approvalMatrix.update).toHaveBeenCalledWith({
        where: { id: 'am-3' },
        data: expect.objectContaining({
          conditionField: null,
          conditionOp: null,
          conditionValue: null,
        }),
      });
    });

    it('deleteMatrix é isolado por empresa', async () => {
      mockPrisma.approvalMatrix.findFirst.mockResolvedValue(null);
      await expect(service.deleteMatrix('am-x', 'co-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.approvalMatrix.delete).not.toHaveBeenCalled();
    });

    it('nível duplicado (mesmo documento e mesmo número) é recusado', async () => {
      // O motor identifica o estado pelo NÚMERO do nível: a 2ª linha ficaria
      // muda no approve() e ainda apareceria como configurada na tela.
      mockPrisma.approvalMatrix.findFirst.mockResolvedValue({ id: 'am-existente' });
      await expect(
        service.createMatrix('co-1', { entityType: 'PO', level: 1, approverRoles: ['DIRETOR'] }),
      ).rejects.toThrow(/Já existe um nível 1/);
      expect(mockPrisma.approvalMatrix.create).not.toHaveBeenCalled();
    });

    it('PATCH parcial da condição (op sem valor) é malformado, não completa com o gravado', async () => {
      mockPrisma.approvalMatrix.findFirst.mockResolvedValue({
        id: 'am-4', companyId: 'co-1', level: 1, entityType: 'PO',
        conditionField: 'amount', conditionOp: 'gte', conditionValue: '5000',
      });
      await expect(
        service.updateMatrix('am-4', 'co-1', { conditionOp: 'lte' }),
      ).rejects.toThrow(/operador e o valor juntos/);
      expect(mockPrisma.approvalMatrix.update).not.toHaveBeenCalled();
    });

    it('limpar a condição enviando valor junto é recusado (par atômico)', async () => {
      mockPrisma.approvalMatrix.findFirst.mockResolvedValue({
        id: 'am-5', companyId: 'co-1', level: 1, entityType: 'PO',
        conditionField: null, conditionOp: null, conditionValue: null,
      });
      await expect(
        service.updateMatrix('am-5', 'co-1', { conditionOp: null as any, conditionValue: 9999 }),
      ).rejects.toThrow(/sem valor junto/);
      expect(mockPrisma.approvalMatrix.update).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // getPending — a fila tem que CONCORDAR com o approve() (#1005 pós-review)
  // ────────────────────────────────────────────────────────────────────────
  describe('getPending (fila concorda com o motor de aprovação)', () => {
    const PO = (id: string, amount: number) => ({
      id,
      createdAt: new Date('2026-08-01'),
      items: [{ quantity: 1, unitCost: amount }],
      supplier: { id: 's1', name: 'F' },
      createdBy: { id: 'u0', name: 'C' },
    });

    beforeEach(() => {
      mockPrisma.purchaseRequest.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
    });

    it('nível cujo VALOR não casa: o documento aparece (portão global), não some da fila', async () => {
      // approve() trata requiredLevels vazio como nível único aprovável por
      // quem tem a permissão — a fila esconder o mesmo documento deixava a
      // PO apodrecendo em DRAFT sem aparecer para NINGUÉM.
      perfisDoUsuario('ALMOXARIFE');
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([PO('po-a', 1000)]);
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { entityType: 'PO', level: 1, conditionField: 'amount', conditionOp: 'gte', conditionValue: '5000', approverRoles: ['DIRETOR'] },
      ]);
      const pending = await service.getPending('co-1', 'u1');
      expect(pending.map((p: any) => p.id)).toEqual(['po-a']);
    });

    it("operadores 'gt'/'lt' valem na fila igual ao approve (avaliador único)", async () => {
      // Matriz: lt 5000 → G.GERAL; gte 5000 → DIRETOR. PO de 100k: o nível
      // 'lt' NÃO se aplica — o gerente não pode aprovar e não deve ver.
      perfisDoUsuario('GERENTE_GERAL');
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([PO('po-b', 100000)]);
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { entityType: 'PO', level: 1, conditionField: 'amount', conditionOp: 'lt', conditionValue: '5000', approverRoles: ['GERENTE_GERAL'] },
        { entityType: 'PO', level: 2, conditionField: 'amount', conditionOp: 'gte', conditionValue: '5000', approverRoles: ['DIRETOR'] },
      ]);
      expect(await service.getPending('co-1', 'u1')).toEqual([]);
    });

    it('nível 1 já aprovado: sai da fila de quem só aprova o nível 1', async () => {
      // A fila olha o PRÓXIMO nível pendente (como o approve), não "qualquer
      // nível aplicável" — senão o item ficava preso no badge do gerente
      // com 403 garantido no clique.
      perfisDoUsuario('GERENTE_GERAL');
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([PO('po-c', 1000)]);
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { entityType: 'PO', level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['GERENTE_GERAL', 'DIRETOR'] },
        { entityType: 'PO', level: 2, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['DIRETOR'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { payload: { documentId: 'po-c', level: 1 } },
      ]);
      expect(await service.getPending('co-1', 'u1')).toEqual([]);
    });

    it('quem casa com o próximo nível pendente VÊ o documento', async () => {
      perfisDoUsuario('DIRETOR');
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([PO('po-d', 1000)]);
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { entityType: 'PO', level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['GERENTE_GERAL', 'DIRETOR'] },
        { entityType: 'PO', level: 2, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['DIRETOR'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { payload: { documentId: 'po-d', level: 1 } },
      ]);
      const pending = await service.getPending('co-1', 'u1');
      expect(pending.map((p: any) => p.id)).toEqual(['po-d']);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // SOD_ENFORCE=false (DEFAULT) — regra de negócio vigente da empresa:
  // a mesma pessoa PODE criar e aprovar; o mesmo usuário pode aprovar
  // níveis distintos. Auditoria registra sempre.
  // ────────────────────────────────────────────────────────────────────────
  describe('SoD DESLIGADO (SOD_ENFORCE=false, default)', () => {
    const matrixSingleLevel = [
      { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['GERENTE_GERAL', 'DIRETOR', 'ADMIN_GLOBAL'] },
    ];
    const matrixTwoLevels = [
      { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['GERENTE_GERAL', 'DIRETOR', 'ADMIN_GLOBAL'] },
      { level: 2, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['DIRETOR', 'ADMIN_GLOBAL'] },
    ];

    it('default (env ausente) = OFF: criador da PO aprova o próprio documento → APPROVED', async () => {
      mockConfig.get.mockReturnValue(undefined); // env não setada → OFF
      perfisDoUsuario('GERENTE_GERAL');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-20', companyId: 'co-1', status: 'DRAFT', createdById: 'user-1',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixSingleLevel);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-20', 'PO', 'co-1', 'user-1');
      expect(result.status).toBe('APPROVED');
    });

    it('SOD_ENFORCE=false explícito: auto-aprovação permitida também no fallback sem matriz', async () => {
      mockConfig.get.mockReturnValue(false);
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-21', companyId: 'co-1', status: 'DRAFT', createdById: 'user-1',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-21', 'PO', 'co-1', 'user-1');
      expect(result.status).toBe('APPROVED');
    });

    it('criador da PR aprova a própria PR → APPROVED', async () => {
      perfisDoUsuario('GERENTE_GERAL');
      mockPrisma.purchaseRequest.findFirst.mockResolvedValue({
        id: 'pr-20', companyId: 'co-1', status: 'OPEN', requestedById: 'user-1',
        quantity: 5, product: { costPrice: 100 },
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixSingleLevel);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseRequest.update.mockResolvedValue({});

      const result = await service.approve('pr-20', 'PR', 'co-1', 'user-1');
      expect(result.status).toBe('APPROVED');
    });

    it('mesmo usuário aprova nível 1 e nível 2 do mesmo documento → APPROVED', async () => {
      perfisDoUsuario('DIRETOR');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-22', companyId: 'co-1', status: 'DRAFT', createdById: 'user-0',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixTwoLevels);
      // director-1 já aprovou o nível 1 e volta para aprovar o nível 2
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { userId: 'director-1', payload: { documentId: 'po-22', level: 1 } },
      ]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-22', 'PO', 'co-1', 'director-1');
      expect(result.status).toBe('APPROVED');
    });

    it('auditoria registra LEVEL_APPROVE com userId mesmo com a flag OFF', async () => {
      perfisDoUsuario('GERENTE_GERAL');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-23', companyId: 'co-1', status: 'DRAFT', createdById: 'user-1',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixSingleLevel);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      // auto-aprovação (permitida com flag OFF)
      await service.approve('po-23', 'PO', 'co-1', 'user-1');

      // trilha de auditoria continua íntegra: LEVEL_APPROVE com o userId real
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            action: 'LEVEL_APPROVE',
          }),
        }),
      );
      // approvedById também registrado na PO
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ approvedById: 'user-1' }),
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // SOD_ENFORCE=true — trava de segregação de funções ativa (#160):
  // os 9 casos originais do PR continuam valendo.
  // ────────────────────────────────────────────────────────────────────────
  describe('SoD LIGADO (SOD_ENFORCE=true) — Segregação de Funções (#160)', () => {
    beforeEach(() => {
      mockConfig.get.mockReturnValue(true);
      perfisDoUsuario('GERENTE_GERAL');
    });

    const matrixSingleLevel = [
      { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['GERENTE_GERAL', 'DIRETOR', 'ADMIN_GLOBAL'] },
    ];
    const matrixTwoLevels = [
      { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['GERENTE_GERAL', 'DIRETOR', 'ADMIN_GLOBAL'] },
      { level: 2, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['DIRETOR', 'ADMIN_GLOBAL'] },
    ];

    it('criador da PO não pode aprová-la (auto-aprovação bloqueada)', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-10', companyId: 'co-1', status: 'DRAFT', createdById: 'user-1',
        items: [{ quantity: 1, unitCost: 100 }],
      });

      await expect(
        service.approve('po-10', 'PO', 'co-1', 'user-1'),
      ).rejects.toThrow('Segregação de funções: o criador do documento não pode aprová-lo');
      expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('ADMIN_GLOBAL NÃO é isento da auto-aprovação', async () => {
      perfisDoUsuario('ADMIN_GLOBAL');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-11', companyId: 'co-1', status: 'DRAFT', createdById: 'admin-1',
        items: [{ quantity: 1, unitCost: 100 }],
      });

      await expect(
        service.approve('po-11', 'PO', 'co-1', 'admin-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('auto-aprovação bloqueada também no fallback sem matriz', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-12', companyId: 'co-1', status: 'DRAFT', createdById: 'user-1',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([]);

      await expect(
        service.approve('po-12', 'PO', 'co-1', 'user-1'),
      ).rejects.toThrow('Segregação de funções: o criador do documento não pode aprová-lo');
    });

    it('criador da PR (requestedById) não pode aprová-la', async () => {
      mockPrisma.purchaseRequest.findFirst.mockResolvedValue({
        id: 'pr-1', companyId: 'co-1', status: 'OPEN', requestedById: 'user-1',
        quantity: 5, product: { costPrice: 100 },
      });

      await expect(
        service.approve('pr-1', 'PR', 'co-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('quem aprovou nível 1 não pode aprovar nível 2 do mesmo documento', async () => {
      perfisDoUsuario('DIRETOR');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-13', companyId: 'co-1', status: 'DRAFT', createdById: 'user-0',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixTwoLevels);
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { userId: 'director-1', payload: { documentId: 'po-13', level: 1 } },
      ]);

      await expect(
        service.approve('po-13', 'PO', 'co-1', 'director-1'),
      ).rejects.toThrow('você já aprovou um nível deste documento');
      expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('fluxo feliz multi-nível: usuários distintos em cada nível → APPROVED', async () => {
      perfisDoUsuario('DIRETOR');
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-14', companyId: 'co-1', status: 'DRAFT', createdById: 'user-0',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixTwoLevels);
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { userId: 'manager-1', payload: { documentId: 'po-14', level: 1 } },
      ]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-14', 'PO', 'co-1', 'director-1');
      expect(result.status).toBe('APPROVED');
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED', approvedById: 'director-1' }),
        }),
      );
    });

    it('fluxo feliz nível único: aprovador diferente do criador → APPROVED', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-15', companyId: 'co-1', status: 'DRAFT', createdById: 'user-0',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixSingleLevel);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-15', 'PO', 'co-1', 'manager-1');
      expect(result.status).toBe('APPROVED');
    });

    it('fallback sem matriz: quem não criou a PO aprova normalmente', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-16', companyId: 'co-1', status: 'DRAFT', createdById: 'user-0',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-16', 'PO', 'co-1', 'manager-1');
      expect(result.status).toBe('APPROVED');
    });

    it('PO legada sem createdById (null) não bloqueia aprovação', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-17', companyId: 'co-1', status: 'DRAFT', createdById: null,
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixSingleLevel);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-17', 'PO', 'co-1', 'manager-1');
      expect(result.status).toBe('APPROVED');
    });
  });
});
