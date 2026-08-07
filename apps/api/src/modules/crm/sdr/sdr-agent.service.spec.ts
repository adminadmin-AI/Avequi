import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../../prisma/prisma.service';
import { CrmSettingsService } from '../crm-settings.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SdrAgentService } from './sdr-agent.service';
import { SdrToolsService } from './sdr-tools';
import { SDR_ACTOR, SDR_CACHE_TTL } from './sdr.types';

// mock do SDK: sem chamada real; classes de erro tipadas preservadas p/ instanceof
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class RateLimitError extends APIError {}
  class InternalServerError extends APIError {}
  class APIConnectionError extends APIError {}
  class BadRequestError extends APIError {}
  class MockAnthropic {
    messages = { create: (...args: unknown[]) => mockCreate(...args) };
    static RateLimitError = RateLimitError;
    static InternalServerError = InternalServerError;
    static APIConnectionError = APIConnectionError;
    static BadRequestError = BadRequestError;
  }
  return { __esModule: true, default: MockAnthropic };
});

const COMPANY = 'company-1';
const LEAD = 'lead-1';

const apiText = (text: string, over: Record<string, unknown> = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
  ...over,
});

describe('SdrAgentService (F4 #521/#523)', () => {
  let service: SdrAgentService;
  let prisma: any;
  let settings: { get: jest.Mock };
  let whatsapp: { send: jest.Mock };
  let tools: { execute: jest.Mock };

  const leadRow = (over: Record<string, unknown> = {}) => ({
    id: LEAD,
    name: 'João',
    source: 'WHATSAPP',
    sdrStatus: null,
    anonymizedAt: null,
    conversation: {
      id: 'conv-1',
      windowExpiresAt: new Date(Date.now() + 3600_000),
      messages: [
        // desc (o service reverte): última do cliente
        { direction: 'IN', type: 'TEXT', text: 'Oi, tem reboque pra 2 jet skis?', sentById: null },
      ],
    },
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      lead: {
        findFirst: jest.fn().mockResolvedValue(leadRow()),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      leadActivity: { create: jest.fn().mockResolvedValue({}) },
      sdrUsage: { create: jest.fn().mockResolvedValue({}) },
    };
    settings = {
      get: jest.fn().mockResolvedValue({
        sdrEnabled: true,
        sdrModel: 'claude-opus-4-8',
        sdrMaxTurns: 12,
        sdrSchedule: '24_7',
      }),
    };
    whatsapp = { send: jest.fn().mockResolvedValue({ id: 'msg-out' }) };
    tools = { execute: jest.fn().mockResolvedValue({ result: '{}', prices: [], terminal: false }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SdrAgentService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'sk-ant-test') } },
        { provide: CrmSettingsService, useValue: settings },
        { provide: WhatsappService, useValue: whatsapp },
        { provide: SdrToolsService, useValue: tools },
      ],
    }).compile();
    service = module.get(SdrAgentService);
  });

  describe('listener crm.lead.created (#521)', () => {
    it('lead WHATSAPP: responde a 1ª mensagem e marca SDR_ATIVO', async () => {
      mockCreate.mockResolvedValue(apiText('Oi João! Temos sim 😊 Pra que tipo de jet ski?'));

      await service.onLeadCreated({ leadId: LEAD, companyId: COMPANY, source: 'WHATSAPP' });

      // request correta: modelo decidido, adaptive thinking, system CONGELADO com cache
      const req = mockCreate.mock.calls[0][0];
      expect(req.model).toBe('claude-opus-4-8');
      expect(req.thinking).toEqual({ type: 'adaptive' });
      // TTL de 1h: o prefixo tools+system é compartilhado entre conversas e
      // com 5min esfriava entre um lead e outro (ver SDR_CACHE_TTL)
      expect(req.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: SDR_CACHE_TTL });
      expect(req.system[0].text).not.toContain('João'); // nada volátil no system!

      // o histórico também precisa do TTL longo: o cliente some no meio da conversa
      const ultima = req.messages[req.messages.length - 1];
      expect(ultima.content[0].cache_control).toEqual({ type: 'ephemeral', ttl: SDR_CACHE_TTL });
      expect(req.tools.length).toBeGreaterThanOrEqual(5);

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: LEAD },
        data: { sdrStatus: 'ACTIVE' },
      });
      expect(whatsapp.send).toHaveBeenCalledWith(
        COMPANY,
        LEAD,
        { text: expect.stringContaining('João') },
        SDR_ACTOR,
      );
      // custo logado (#524)
      expect(prisma.sdrUsage.create).toHaveBeenCalled();
    });

    it('origem não-WHATSAPP não dispara IA na criação (espera o cliente chamar)', async () => {
      await service.onLeadCreated({ leadId: LEAD, companyId: COMPANY, source: 'META_ADS' });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('voice note transcrita (F1 #506/#567) entra no histórico como texto do cliente', async () => {
      prisma.lead.findFirst.mockResolvedValue(
        leadRow({
          conversation: {
            id: 'conv-1',
            windowExpiresAt: new Date(Date.now() + 3600_000),
            messages: [
              {
                direction: 'IN',
                type: 'AUDIO',
                text: '[áudio transcrito] tem reboque pra 2 jet skis?',
                sentById: null,
              },
            ],
          },
        }),
      );
      mockCreate.mockResolvedValue(apiText('Temos sim! De qual cidade você fala?'));

      await service.onMessageReceived({ leadId: LEAD, companyId: COMPANY });

      // o texto transcrito chega ao modelo como mensagem do cliente (role user)
      const req = mockCreate.mock.calls[0][0];
      const lastUser = req.messages[req.messages.length - 1];
      const asText = JSON.stringify(lastUser.content);
      expect(lastUser.role).toBe('user');
      expect(asText).toContain('[áudio transcrito] tem reboque pra 2 jet skis?');
      // e o SDR respondeu normalmente (não caiu no handoff de "não vejo áudio")
      expect(whatsapp.send).toHaveBeenCalled();
    });
  });

  describe('elegibilidade e kill switch (#523)', () => {
    it('kill switch desligado → IA não age', async () => {
      settings.get.mockResolvedValue({ sdrEnabled: false, sdrModel: 'x', sdrMaxTurns: 12, sdrSchedule: '24_7' });
      await service.onMessageReceived({ leadId: LEAD, companyId: COMPANY });
      expect(mockCreate).not.toHaveBeenCalled();
      expect(whatsapp.send).not.toHaveBeenCalled();
    });

    it('lead em HANDOFF (humano assumiu) → IA fica quieta', async () => {
      prisma.lead.findFirst.mockResolvedValue(leadRow({ sdrStatus: 'HANDOFF' }));
      await service.onMessageReceived({ leadId: LEAD, companyId: COMPANY });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('janela de 24h fechada → não chama a API', async () => {
      prisma.lead.findFirst.mockResolvedValue(
        leadRow({
          conversation: {
            id: 'conv-1',
            windowExpiresAt: new Date(Date.now() - 1000),
            messages: [{ direction: 'IN', type: 'TEXT', text: 'oi', sentById: null }],
          },
        }),
      );
      await service.onMessageReceived({ leadId: LEAD, companyId: COMPANY });
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('takeover (#521/#524)', () => {
    it('vendedor digitou → IA silencia na hora (implícito)', async () => {
      await service.onMessageSent({ leadId: LEAD, senderId: 'seller-1' });
      expect(prisma.lead.updateMany).toHaveBeenCalledWith({
        where: { id: LEAD, sdrStatus: { in: ['ACTIVE', 'QUALIFIED'] } },
        data: { sdrStatus: 'HANDOFF' },
      });
    });

    it('mensagem da própria IA não conta como takeover', async () => {
      await service.onMessageSent({ leadId: LEAD, senderId: SDR_ACTOR });
      expect(prisma.lead.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('loop de tools (#522)', () => {
    it('tool_use → executa, devolve resultados num ÚNICO user message e responde', async () => {
      tools.execute.mockResolvedValue({
        result: JSON.stringify({ itens: [{ precoTabela: '12500.00' }] }),
        prices: ['12500.00'],
        terminal: false,
      });
      mockCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Vou ver pra você!' },
            { type: 'tool_use', id: 'tu-1', name: 'consultar_estoque', input: { busca: 'jet ski' } },
          ],
          usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 900 },
        })
        .mockResolvedValueOnce(apiText('Temos sim! O modelo pra 2 jets sai R$ 12.500,00. De qual cidade você fala?'));

      await service.onMessageReceived({ leadId: LEAD, companyId: COMPANY });

      expect(tools.execute).toHaveBeenCalledWith(COMPANY, LEAD, 'consultar_estoque', { busca: 'jet ski' });
      // tool_results num único user message
      const secondReq = mockCreate.mock.calls[1][0];
      const lastMsg = secondReq.messages[secondReq.messages.length - 1];
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu-1' });
      // preço veio da tool → guardrail deixa passar
      expect(whatsapp.send).toHaveBeenCalledWith(
        COMPANY,
        LEAD,
        { text: expect.stringContaining('12.500') },
        SDR_ACTOR,
      );
    });
  });

  describe('guardrail de preço em código (#523)', () => {
    it('resposta com preço SEM tool call → bloqueia envio, loga incidente e transfere', async () => {
      mockCreate.mockResolvedValue(apiText('Esse sai R$ 9.999 pra você!'));

      await service.onMessageReceived({ leadId: LEAD, companyId: COMPANY });

      // a resposta com preço inventado NUNCA chega ao cliente
      expect(whatsapp.send).not.toHaveBeenCalledWith(
        COMPANY,
        LEAD,
        { text: expect.stringContaining('9.999') },
        expect.anything(),
      );
      // incidente logado (painel #524)
      expect(prisma.leadActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            properties: expect.objectContaining({ kind: 'sdr_guardrail_incident' }),
          }),
        }),
      );
      // handoff forçado via tool
      expect(tools.execute).toHaveBeenCalledWith(
        COMPANY,
        LEAD,
        'transferir_para_vendedor',
        expect.objectContaining({ motivo: expect.stringContaining('guardrail') }),
      );
    });
  });

  describe('handoff garantido por trocas (#523)', () => {
    it('IA já respondeu maxTurns vezes → transfere sem chamar a API', async () => {
      const aiMsgs = Array.from({ length: 12 }, () => ({
        direction: 'OUT',
        type: 'TEXT',
        text: 'resposta da IA',
        sentById: SDR_ACTOR,
      }));
      prisma.lead.findFirst.mockResolvedValue(
        leadRow({
          sdrStatus: 'ACTIVE',
          conversation: {
            id: 'conv-1',
            windowExpiresAt: new Date(Date.now() + 3600_000),
            messages: [{ direction: 'IN', type: 'TEXT', text: 'e aí?', sentById: null }, ...aiMsgs],
          },
        }),
      );
      await service.onMessageReceived({ leadId: LEAD, companyId: COMPANY });
      expect(mockCreate).not.toHaveBeenCalled();
      expect(tools.execute).toHaveBeenCalledWith(
        COMPANY,
        LEAD,
        'transferir_para_vendedor',
        expect.objectContaining({ motivo: expect.stringContaining('12 trocas') }),
      );
    });
  });

  describe('circuit breaker e degradação graciosa (#523)', () => {
    it('3 falhas retryable abrem o breaker; leads seguem no fluxo humano sem erro visível', async () => {
      mockCreate.mockRejectedValue(new (Anthropic as any).RateLimitError('429'));

      for (let i = 0; i < 3; i++) {
        await service.onMessageReceived({ leadId: LEAD, companyId: COMPANY });
      }
      expect(mockCreate).toHaveBeenCalledTimes(3);
      // cada falha → handoff silencioso (sem mensagem quebrada ao cliente)
      expect(tools.execute).toHaveBeenCalledWith(
        COMPANY,
        LEAD,
        'transferir_para_vendedor',
        expect.objectContaining({ motivo: expect.stringContaining('IA indisponível') }),
      );
      expect(whatsapp.send).not.toHaveBeenCalled();

      // breaker aberto: próximo turno nem chama a API
      mockCreate.mockClear();
      await service.onMessageReceived({ leadId: LEAD, companyId: COMPANY });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('sucesso zera o contador do breaker (reativação automática)', async () => {
      mockCreate
        .mockRejectedValueOnce(new (Anthropic as any).RateLimitError('429'))
        .mockRejectedValueOnce(new (Anthropic as any).RateLimitError('429'))
        .mockResolvedValueOnce(apiText('Oi! Como posso ajudar?'))
        .mockRejectedValueOnce(new (Anthropic as any).RateLimitError('429'));

      for (let i = 0; i < 4; i++) {
        await service.onMessageReceived({ leadId: LEAD, companyId: COMPANY });
      }
      // 4 chamadas feitas = breaker NÃO abriu no meio (sucesso resetou)
      expect(mockCreate).toHaveBeenCalledTimes(4);
    });
  });
});
