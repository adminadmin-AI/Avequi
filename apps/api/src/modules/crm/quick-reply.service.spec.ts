import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { QuickReplyService, RequestActor } from './quick-reply.service';

const COMPANY = 'company-1';
const SELLER: RequestActor = { id: 'seller-1', companyId: COMPANY, role: 'COMMERCIAL' };
const OTHER_SELLER: RequestActor = { id: 'seller-2', companyId: COMPANY, role: 'STORE' };
const MANAGER: RequestActor = { id: 'manager-1', companyId: COMPANY, role: 'MANAGER' };

describe('QuickReplyService (F3.5-C3 #553)', () => {
  let service: QuickReplyService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      quickReply: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: 'qr-1', ...data })),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [QuickReplyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(QuickReplyService);
  });

  describe('list', () => {
    it('devolve pessoais do vendedor + compartilhadas da loja (nunca pessoais de outro)', async () => {
      await service.list(SELLER);
      expect(prisma.quickReply.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: COMPANY,
            OR: [{ ownerId: null }, { ownerId: SELLER.id }],
          },
        }),
      );
    });
  });

  describe('create', () => {
    it('vendedor cria resposta pessoal com atalho normalizado (tira "/" e baixa caixa)', async () => {
      const created = await service.create(SELLER, {
        shortcut: '/PIX',
        text: 'Nossa chave PIX é o CNPJ',
        scope: 'PERSONAL',
      });
      expect(created.shortcut).toBe('pix');
      expect(created.ownerId).toBe(SELLER.id);
      expect(created.companyId).toBe(COMPANY);
    });

    it('gerente cria resposta da loja (ownerId null)', async () => {
      const created = await service.create(MANAGER, {
        shortcut: 'frete',
        text: 'O frete é calculado por km',
        scope: 'STORE',
      });
      expect(created.ownerId).toBeNull();
    });

    it('vendedor NÃO cria resposta da loja', async () => {
      await expect(
        service.create(SELLER, { shortcut: 'frete', text: 'x', scope: 'STORE' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejeita atalho inválido (espaço/acento/vazio)', async () => {
      for (const bad of ['meu atalho', 'çedilha', '', '-comeca-com-traco']) {
        await expect(
          service.create(SELLER, { shortcut: bad, text: 'x', scope: 'PERSONAL' }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('rejeita texto vazio', async () => {
      await expect(
        service.create(SELLER, { shortcut: 'pix', text: '   ', scope: 'PERSONAL' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita atalho duplicado no MESMO escopo (validado em código — NULLs distintos no PG)', async () => {
      prisma.quickReply.findFirst.mockResolvedValueOnce({ id: 'qr-x', shortcut: 'pix' });
      await expect(
        service.create(SELLER, { shortcut: 'pix', text: 'x', scope: 'PERSONAL' }),
      ).rejects.toThrow(ConflictException);
      // dedup consultou o escopo certo (pessoal do vendedor)
      expect(prisma.quickReply.findFirst).toHaveBeenCalledWith({
        where: { companyId: COMPANY, ownerId: SELLER.id, shortcut: 'pix' },
      });
    });

    it('permite mesmo atalho em escopos diferentes (loja x pessoal)', async () => {
      // dedup só olha o próprio escopo: findFirst devolve null → cria
      const created = await service.create(MANAGER, {
        shortcut: 'pix',
        text: 'chave da loja',
        scope: 'STORE',
      });
      expect(prisma.quickReply.findFirst).toHaveBeenCalledWith({
        where: { companyId: COMPANY, ownerId: null, shortcut: 'pix' },
      });
      expect(created.ownerId).toBeNull();
    });
  });

  describe('update', () => {
    it('dono edita a própria resposta pessoal', async () => {
      prisma.quickReply.findFirst.mockResolvedValueOnce({
        id: 'qr-1',
        companyId: COMPANY,
        ownerId: SELLER.id,
        shortcut: 'pix',
      });
      await service.update(SELLER, 'qr-1', { text: 'novo texto' });
      expect(prisma.quickReply.update).toHaveBeenCalledWith({
        where: { id: 'qr-1' },
        data: { text: 'novo texto' },
      });
    });

    it('vendedor NÃO edita pessoal de outro vendedor', async () => {
      prisma.quickReply.findFirst.mockResolvedValueOnce({
        id: 'qr-1',
        companyId: COMPANY,
        ownerId: SELLER.id,
      });
      await expect(service.update(OTHER_SELLER, 'qr-1', { text: 'x' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('vendedor NÃO edita resposta da loja; gerente pode', async () => {
      const storeReply = { id: 'qr-2', companyId: COMPANY, ownerId: null, shortcut: 'frete' };
      prisma.quickReply.findFirst.mockResolvedValueOnce(storeReply);
      await expect(service.update(SELLER, 'qr-2', { text: 'x' })).rejects.toThrow(
        ForbiddenException,
      );

      prisma.quickReply.findFirst.mockResolvedValueOnce(storeReply);
      await service.update(MANAGER, 'qr-2', { text: 'ok' });
      expect(prisma.quickReply.update).toHaveBeenCalled();
    });

    it('troca de atalho revalida duplicidade no escopo', async () => {
      prisma.quickReply.findFirst
        .mockResolvedValueOnce({ id: 'qr-1', companyId: COMPANY, ownerId: SELLER.id, shortcut: 'pix' })
        .mockResolvedValueOnce({ id: 'qr-9', shortcut: 'endereco' }); // clash
      await expect(service.update(SELLER, 'qr-1', { shortcut: 'endereco' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('404 quando a resposta é de outra company (isolamento multi-tenant)', async () => {
      prisma.quickReply.findFirst.mockResolvedValueOnce(null);
      await expect(service.update(SELLER, 'qr-alheio', { text: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.quickReply.findFirst).toHaveBeenCalledWith({
        where: { id: 'qr-alheio', companyId: COMPANY },
      });
    });
  });

  describe('remove', () => {
    it('dono exclui a própria resposta', async () => {
      prisma.quickReply.findFirst.mockResolvedValueOnce({
        id: 'qr-1',
        companyId: COMPANY,
        ownerId: SELLER.id,
      });
      const res = await service.remove(SELLER, 'qr-1');
      expect(res).toEqual({ deleted: true });
      expect(prisma.quickReply.delete).toHaveBeenCalledWith({ where: { id: 'qr-1' } });
    });

    it('gerente exclui resposta pessoal de vendedor (moderação)', async () => {
      prisma.quickReply.findFirst.mockResolvedValueOnce({
        id: 'qr-1',
        companyId: COMPANY,
        ownerId: SELLER.id,
      });
      await service.remove(MANAGER, 'qr-1');
      expect(prisma.quickReply.delete).toHaveBeenCalled();
    });
  });
});
