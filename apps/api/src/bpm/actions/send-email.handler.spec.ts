import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SendEmailHandler } from './send-email.handler';
import { PrismaService } from '../../prisma/prisma.service';
import { ActionContext } from '../engine/action-executor';

const mockFindFirst = jest.fn();
const mockCreateNotification = jest.fn();
const mockEmit = jest.fn();

const mockPrisma = {
  emailTemplate: { findFirst: mockFindFirst },
  notification: { create: mockCreateNotification },
};

const baseContext: ActionContext = {
  companyId: 'company-1',
  instanceId: 'instance-1',
  nodeId: 'node-1',
  config: {
    actionType: 'SEND_EMAIL',
    to: 'manager@gdr.com',
    subject: 'Pedido aprovado',
    body: 'Seu pedido foi aprovado.',
  },
  variables: { customerName: 'GDR Reboques', amount: 50000 },
};

describe('SendEmailHandler', () => {
  let handler: SendEmailHandler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCreateNotification.mockResolvedValue({ id: 'notif-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendEmailHandler,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
      ],
    }).compile();

    handler = module.get<SendEmailHandler>(SendEmailHandler);
  });

  it('should have type SEND_EMAIL', () => {
    expect(handler.type).toBe('SEND_EMAIL');
  });

  it('should return error when "to" is missing', async () => {
    const result = await handler.execute({ ...baseContext, config: { actionType: 'SEND_EMAIL' } });
    expect(result.success).toBe(false);
    expect(result.error).toContain('"to"');
  });

  it('should send email using direct body config', async () => {
    const result = await handler.execute(baseContext);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ to: 'manager@gdr.com', subject: 'Pedido aprovado' });
    expect(mockEmit).toHaveBeenCalledWith('email.send', expect.objectContaining({ to: 'manager@gdr.com' }));
  });

  it('should create a notification record for in-app delivery', async () => {
    await handler.execute(baseContext);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          type: 'INFO',
          entityType: 'WorkflowInstance',
          entityId: 'instance-1',
        }),
      }),
    );
  });

  describe('template interpolation', () => {
    it('should interpolate {{variable}} in direct body', async () => {
      const ctx: ActionContext = {
        ...baseContext,
        config: {
          actionType: 'SEND_EMAIL',
          to: 'test@test.com',
          body: 'Olá {{customerName}}, seu pedido de R$ {{amount}} foi aprovado!',
        },
      };
      const result = await handler.execute(ctx);
      expect(result.data.bodyHtml).toBe('Olá GDR Reboques, seu pedido de R$ 50000 foi aprovado!');
    });

    it('should leave unresolved placeholders intact', async () => {
      const ctx: ActionContext = {
        ...baseContext,
        config: {
          actionType: 'SEND_EMAIL',
          to: 'test@test.com',
          body: 'Olá {{unknownVar}}',
        },
      };
      const result = await handler.execute(ctx);
      expect(result.data.bodyHtml).toBe('Olá {{unknownVar}}');
    });

    it('should use email template from DB when templateName provided', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'tpl-1',
        subject: 'Alerta: {{customerName}}',
        bodyHtml: '<p>Valor: {{amount}}</p>',
      });

      const ctx: ActionContext = {
        ...baseContext,
        config: {
          actionType: 'SEND_EMAIL',
          to: 'admin@gdr.com',
          templateName: 'PURCHASE_ALERT',
        },
      };
      const result = await handler.execute(ctx);
      expect(result.success).toBe(true);
      expect(result.data.subject).toBe('Alerta: GDR Reboques');
      expect(result.data.bodyHtml).toBe('<p>Valor: 50000</p>');
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ name: 'PURCHASE_ALERT', companyId: 'company-1' }),
        }),
      );
    });

    it('should return error when templateName not found', async () => {
      mockFindFirst.mockResolvedValue(null);

      const ctx: ActionContext = {
        ...baseContext,
        config: {
          actionType: 'SEND_EMAIL',
          to: 'admin@gdr.com',
          templateName: 'NONEXISTENT',
        },
      };
      const result = await handler.execute(ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('NONEXISTENT');
    });
  });

  describe('interpolate method', () => {
    it('should replace multiple variables', () => {
      const result = handler.interpolate('{{a}} + {{b}} = {{c}}', { a: 1, b: 2, c: 3 });
      expect(result).toBe('1 + 2 = 3');
    });

    it('should handle empty variables object', () => {
      const result = handler.interpolate('Hello {{name}}', {});
      expect(result).toBe('Hello {{name}}');
    });

    it('should handle null variable value', () => {
      const result = handler.interpolate('Value: {{x}}', { x: null });
      expect(result).toBe('Value: {{x}}');
    });
  });
});
