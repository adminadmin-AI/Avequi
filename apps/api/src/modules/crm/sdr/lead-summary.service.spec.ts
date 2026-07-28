import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeadSummaryService } from './lead-summary.service';

// mesmo mock do SDK usado no SDR: sem chamada real à API
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: (...args: unknown[]) => mockCreate(...args) };
  }
  return { __esModule: true, default: MockAnthropic };
});

const COMPANY = 'company-1';
const LEAD = 'lead-1';

const toolResponse = (input: Record<string, unknown>) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'tu-1', name: 'registrar_resumo', input }],
  usage: { input_tokens: 1200, output_tokens: 90, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

describe('LeadSummaryService (V2.6 #573)', () => {
  let service: LeadSummaryService;
  let prisma: any;
  let config: { get: jest.Mock };

  const leadRow = (over: Record<string, unknown> = {}) => ({
    id: LEAD,
    name: 'João',
    source: 'WHATSAPP',
    anonymizedAt: null,
    conversation: {
      messages: [
        { direction: 'OUT', type: 'TEXT', text: 'Oi! Como posso ajudar?' },
        { direction: 'IN', type: 'TEXT', text: 'Quero um reboque pra 2 jet skis, sou de Maringá' },
      ],
    },
    ...over,
  });

  async function build(apiKey: string | undefined) {
    config = { get: jest.fn(() => apiKey) };
    prisma = {
      lead: { findFirst: jest.fn().mockResolvedValue(leadRow()) },
      leadActivity: { create: jest.fn().mockResolvedValue({ id: 'act-1' }) },
      sdrUsage: { create: jest.fn().mockResolvedValue({}) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadSummaryService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(LeadSummaryService);
  }

  beforeEach(() => jest.clearAllMocks());

  describe('guarda sem ANTHROPIC_API_KEY', () => {
    it('isAvailable = false e summarize devolve 503 sem chamar a API', async () => {
      await build(undefined);
      expect(service.isAvailable()).toBe(false);
      await expect(service.summarize(COMPANY, LEAD, 'seller-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(mockCreate).not.toHaveBeenCalled();
      expect(prisma.lead.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('geração do resumo', () => {
    it('usa o modelo barato haiku com saída estruturada forçada (tool_choice)', async () => {
      await build('sk-ant-test');
      mockCreate.mockResolvedValue(
        toolResponse({ resumo: 'Cliente quer reboque para 2 jet skis.', cidade: 'Maringá' }),
      );

      await service.summarize(COMPANY, LEAD, 'seller-1');

      const req = mockCreate.mock.calls[0][0];
      expect(req.model).toBe('claude-haiku-4-5');
      expect(req.tool_choice).toEqual({ type: 'tool', name: 'registrar_resumo' });
      expect(req.tools).toHaveLength(1);
    });

    it('grava NOTE conversation_summary na timeline com só os dados descobertos', async () => {
      await build('sk-ant-test');
      mockCreate.mockResolvedValue(
        toolResponse({
          resumo: 'Cliente de Maringá quer reboque para 2 jet skis. Sem prazo definido.',
          cidade: 'Maringá',
          necessidade: 'reboque para 2 jet skis',
          prazo: '', // vazio não deve entrar em discovered
        }),
      );

      const res = await service.summarize(COMPANY, LEAD, 'seller-1');

      const noteArg = prisma.leadActivity.create.mock.calls[0][0].data;
      expect(noteArg.type).toBe('NOTE');
      expect(noteArg.actorId).toBe('seller-1');
      expect(noteArg.properties.kind).toBe('conversation_summary');
      expect(noteArg.properties.discovered).toEqual({
        cidade: 'Maringá',
        necessidade: 'reboque para 2 jet skis',
      });
      expect(noteArg.properties.discovered.prazo).toBeUndefined();
      expect(res.discovered).toEqual({ cidade: 'Maringá', necessidade: 'reboque para 2 jet skis' });
    });

    it('loga o custo em SdrUsage com o model haiku (painel de custo identifica)', async () => {
      await build('sk-ant-test');
      mockCreate.mockResolvedValue(toolResponse({ resumo: 'Resumo qualquer.' }));

      await service.summarize(COMPANY, LEAD, 'seller-1');

      const usageArg = prisma.sdrUsage.create.mock.calls[0][0].data;
      expect(usageArg.companyId).toBe(COMPANY);
      expect(usageArg.leadId).toBe(LEAD);
      expect(usageArg.model).toBe('claude-haiku-4-5');
      expect(usageArg.inputTokens).toBe(1200);
    });
  });

  describe('isolamento por companyId (#573)', () => {
    it('lead de outra loja não é encontrado → 404 e a conversa nunca chega ao prompt', async () => {
      await build('sk-ant-test');
      prisma.lead.findFirst.mockResolvedValue(null); // escopo companyId não casou

      await expect(service.summarize('outra-company', LEAD, 'seller-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // where escopado por companyId
      expect(prisma.lead.findFirst.mock.calls[0][0].where).toMatchObject({
        id: LEAD,
        companyId: 'outra-company',
      });
      expect(mockCreate).not.toHaveBeenCalled();
      expect(prisma.leadActivity.create).not.toHaveBeenCalled();
    });
  });

  describe('conversa vazia', () => {
    it('lead sem mensagens → 400, sem chamar a API', async () => {
      await build('sk-ant-test');
      prisma.lead.findFirst.mockResolvedValue(leadRow({ conversation: { messages: [] } }));

      await expect(service.summarize(COMPANY, LEAD, 'seller-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
