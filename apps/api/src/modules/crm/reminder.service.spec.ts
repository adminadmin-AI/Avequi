import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../iam/permission.service';
import { ReminderService, ReminderActor } from './reminder.service';

const COMPANY = 'company-1';
const SELLER: ReminderActor = { id: 'seller-1', companyId: COMPANY };
const OTHER_SELLER: ReminderActor = { id: 'seller-2', companyId: COMPANY };
const MANAGER: ReminderActor = { id: 'manager-1', companyId: COMPANY };

/** Bloco F (#624): gerir lembrete alheio agora vem do IAM v2, nunca do enum —
 *  no teste, só o "manager-1" tem crm.reminders.manage-all. */
const MANAGE_ALL_USERS = new Set([MANAGER.id]);

const FUTURE = new Date(Date.now() + 24 * 3600_000).toISOString();

describe('ReminderService (F3.5-C5 #555)', () => {
  let service: ReminderService;
  let prisma: any;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      lead: {
        findFirst: jest.fn().mockResolvedValue({ id: 'lead-1' }),
        update: jest.fn(),
      },
      leadActivity: {
        create: jest.fn(async ({ data }: any) => ({ id: 'act-1', ...data })),
      },
      leadReminder: {
        create: jest.fn(async ({ data }: any) => ({ id: 'rem-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
        delete: jest.fn(),
      },
      alert: {
        create: jest.fn(),
      },
    };
    eventEmitter = { emit: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReminderService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        {
          provide: PermissionService,
          useValue: {
            hasPermission: jest.fn(
              async (userId: string, _companyId: string, code: string) =>
                code === 'crm.reminders.manage-all' && MANAGE_ALL_USERS.has(userId),
            ),
          },
        },
      ],
    }).compile();
    service = module.get(ReminderService);
  });

  describe('addNote', () => {
    it('cria LeadActivity NOTE com actorId do vendedor e atualiza lastInteractionAt', async () => {
      const note = await service.addNote(SELLER, 'lead-1', 'Cliente prefere reboque basculante');
      expect(note.type).toBe('NOTE');
      expect(note.actorId).toBe(SELLER.id);
      expect((note.properties as any).text).toContain('basculante');
      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { lastInteractionAt: expect.any(Date) },
      });
    });

    it('rejeita nota vazia', async () => {
      await expect(service.addNote(SELLER, 'lead-1', '   ')).rejects.toThrow(BadRequestException);
    });

    it('404 quando o lead é de outra loja (isolamento multi-tenant)', async () => {
      prisma.lead.findFirst.mockResolvedValueOnce(null);
      await expect(service.addNote(SELLER, 'lead-alheio', 'x')).rejects.toThrow(NotFoundException);
      expect(prisma.lead.findFirst).toHaveBeenCalledWith({
        where: { id: 'lead-alheio', companyId: COMPANY },
        select: { id: true },
      });
    });
  });

  describe('createReminder', () => {
    it('agenda lembrete futuro pro vendedor', async () => {
      const r = await service.createReminder(SELLER, 'lead-1', {
        text: 'ligar amanhã 14h',
        dueAt: FUTURE,
      });
      expect(r.userId).toBe(SELLER.id);
      expect(r.companyId).toBe(COMPANY);
      expect(r.dueAt).toEqual(new Date(FUTURE));
    });

    it('rejeita vencimento no passado', async () => {
      const past = new Date(Date.now() - 3600_000).toISOString();
      await expect(
        service.createReminder(SELLER, 'lead-1', { text: 'x', dueAt: past }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita data inválida e texto vazio', async () => {
      await expect(
        service.createReminder(SELLER, 'lead-1', { text: 'x', dueAt: 'não-é-data' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createReminder(SELLER, 'lead-1', { text: ' ', dueAt: FUTURE }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listMine', () => {
    it('só pendentes do próprio vendedor, vencimento ascendente', async () => {
      await service.listMine(SELLER);
      expect(prisma.leadReminder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: COMPANY, userId: SELLER.id, doneAt: null },
          orderBy: { dueAt: 'asc' },
        }),
      );
    });
  });

  describe('markDone / remove', () => {
    const MINE = { id: 'rem-1', companyId: COMPANY, userId: SELLER.id };

    it('dono conclui o lembrete', async () => {
      prisma.leadReminder.findFirst.mockResolvedValueOnce(MINE);
      await service.markDone(SELLER, 'rem-1');
      expect(prisma.leadReminder.update).toHaveBeenCalledWith({
        where: { id: 'rem-1' },
        data: { doneAt: expect.any(Date) },
      });
    });

    it('outro vendedor NÃO conclui (404 — não vaza existência); gerente pode', async () => {
      prisma.leadReminder.findFirst.mockResolvedValueOnce(MINE);
      await expect(service.markDone(OTHER_SELLER, 'rem-1')).rejects.toThrow(NotFoundException);

      prisma.leadReminder.findFirst.mockResolvedValueOnce(MINE);
      await service.markDone(MANAGER, 'rem-1');
      expect(prisma.leadReminder.update).toHaveBeenCalled();
    });

    it('dono exclui o lembrete', async () => {
      prisma.leadReminder.findFirst.mockResolvedValueOnce(MINE);
      const res = await service.remove(SELLER, 'rem-1');
      expect(res).toEqual({ deleted: true });
      expect(prisma.leadReminder.delete).toHaveBeenCalledWith({ where: { id: 'rem-1' } });
    });
  });

  describe('notifyDue (cron)', () => {
    it('lembrete vencido gera Alert CRM_REMINDER_DUE e marca notifiedAt (não realerta)', async () => {
      prisma.leadReminder.findMany.mockResolvedValueOnce([
        {
          id: 'rem-1',
          companyId: COMPANY,
          leadId: 'lead-1',
          text: 'ligar amanhã 14h',
          lead: { name: 'João', phone: '5545999998888' },
          user: { name: 'Vendedor 1' },
        },
      ]);
      const n = await service.notifyDue();
      expect(n).toBe(1);
      expect(prisma.alert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: COMPANY,
          type: 'CRM_REMINDER_DUE',
          severity: 'INFO',
          title: 'Lembrete: ligar amanhã 14h',
          body: expect.stringContaining('João'),
          entityId: 'lead-1',
          entityType: 'Lead',
        }),
      });
      expect(prisma.leadReminder.update).toHaveBeenCalledWith({
        where: { id: 'rem-1' },
        data: { notifiedAt: expect.any(Date) },
      });
      // varredura só pega pendente, não notificado e vencido
      expect(prisma.leadReminder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { doneAt: null, notifiedAt: null, dueAt: { lte: expect.any(Date) } },
        }),
      );
    });

    it('falha num alerta não derruba a varredura dos demais', async () => {
      prisma.leadReminder.findMany.mockResolvedValueOnce([
        { id: 'rem-1', companyId: COMPANY, leadId: 'l1', text: 'a', lead: {}, user: {} },
        { id: 'rem-2', companyId: COMPANY, leadId: 'l2', text: 'b', lead: {}, user: {} },
      ]);
      prisma.alert.create.mockRejectedValueOnce(new Error('db down'));
      const n = await service.notifyDue();
      expect(n).toBe(2);
      // o segundo ainda foi notificado
      expect(prisma.leadReminder.update).toHaveBeenCalledTimes(1);
      expect(prisma.leadReminder.update).toHaveBeenCalledWith({
        where: { id: 'rem-2' },
        data: { notifiedAt: expect.any(Date) },
      });
    });
  });
});
