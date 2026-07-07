import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type Anthropic from '@anthropic-ai/sdk';
import { LeadActivityType, Prisma, SdrLeadStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CrmService } from '../crm.service';
import { SDR_ACTOR } from './sdr.types';

/**
 * F4.2 (#522) — tools do SDR: o que o diferencia de chatbot genérico é
 * consultar o ERP DE VERDADE. Todas strict (input validado contra o schema)
 * e com descrição PRESCRITIVA de quando chamar (lift mensurável no Opus 4.8).
 */
export const SDR_TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    name: 'consultar_estoque',
    description:
      'Consulta disponibilidade e preço de tabela dos reboques na loja. Chame SEMPRE que o cliente perguntar se tem, quanto custa, ou citar um modelo/categoria (jet ski, carga, barco, mudança...). NUNCA responda disponibilidade ou preço sem chamar esta tool.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        busca: {
          type: 'string',
          description:
            'Termo de busca: nome/categoria/uso do reboque como o cliente falou (ex: "reboque 2 jet skis", "carretinha de carga")',
        },
      },
      required: ['busca'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_prazo_entrega',
    description:
      'Consulta o prazo de entrega/produção de um produto específico. Chame quando o cliente perguntar prazo, "pra quando", ou demonstrar urgência. Use o produtoId retornado por consultar_estoque. NUNCA prometa prazo sem chamar esta tool.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        produtoId: { type: 'string', description: 'id do produto retornado por consultar_estoque' },
      },
      required: ['produtoId'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_qualificacao',
    description:
      'Registra a qualificação do lead no CRM. Chame quando tiver descoberto o interesse e pelo menos mais um dado (cidade, prazo ou pagamento) — antes de transferir. Score: 80-100 pronto pra comprar, 50-79 interessado qualificado, 20-49 curioso, 0-19 frio.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        interesse: { type: 'string', description: 'modelo/categoria de interesse (texto curto)' },
        uso: { type: 'string', description: 'pra que vai usar' },
        cidade: { type: 'string', description: 'cidade do cliente (vazio se não descobriu)' },
        prazo: { type: 'string', description: 'pra quando precisa (vazio se não descobriu)' },
        formaPagamento: {
          type: 'string',
          description: 'à vista/cartão/financiamento (vazio se não descobriu)',
        },
        score: { type: 'integer', description: 'temperatura do lead 0-100' },
        resumo: { type: 'string', description: 'resumo da conversa em 1-2 frases' },
      },
      required: ['interesse', 'uso', 'cidade', 'prazo', 'formaPagamento', 'score', 'resumo'],
      additionalProperties: false,
    },
  },
  {
    name: 'transferir_para_vendedor',
    description:
      'Transfere a conversa pro vendedor humano e encerra sua atuação. Chame IMEDIATAMENTE quando: cliente pedir desconto/negociar, pedir humano, estiver irritado, fizer pergunta técnica que você não sabe, ou estiver pronto pra fechar. Depois de chamar, mande UMA mensagem curta de transição citando o nome do vendedor retornado.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        motivo: {
          type: 'string',
          description:
            'motivo curto: "pedido de desconto", "pediu humano", "pronto pra fechar", "pergunta técnica", "cliente irritado"...',
        },
        resumoConversa: {
          type: 'string',
          description:
            'resumo ACIONÁVEL pro vendedor em 2-4 frases: o que o cliente quer, dados descobertos, o que falta',
        },
      },
      required: ['motivo', 'resumoConversa'],
      additionalProperties: false,
    },
  },
  {
    name: 'descartar_lead',
    description:
      'Descarta o lead (spam, número errado, engano, concorrente). Chame SÓ com certeza — na dúvida use transferir_para_vendedor. O gerente pode reverter depois.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'motivo curto do descarte' },
      },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
];

export interface ToolOutcome {
  /** resultado devolvido pro modelo (JSON string) */
  result: string;
  /** preços retornados — alimentam o validador de preço do guardrail (#523) */
  prices: string[];
  /** true = a conversa da IA terminou (handoff/descarte) */
  terminal: boolean;
}

@Injectable()
export class SdrToolsService {
  private readonly logger = new Logger(SdrToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Executa uma tool call e loga na timeline (auditoria do painel #524) */
  async execute(companyId: string, leadId: string, name: string, input: any): Promise<ToolOutcome> {
    let outcome: ToolOutcome;
    try {
      switch (name) {
        case 'consultar_estoque':
          outcome = await this.consultarEstoque(companyId, input.busca);
          break;
        case 'consultar_prazo_entrega':
          outcome = await this.consultarPrazo(companyId, input.produtoId);
          break;
        case 'registrar_qualificacao':
          outcome = await this.registrarQualificacao(companyId, leadId, input);
          break;
        case 'transferir_para_vendedor':
          outcome = await this.transferir(companyId, leadId, input.motivo, input.resumoConversa);
          break;
        case 'descartar_lead':
          outcome = await this.descartar(companyId, leadId, input.motivo);
          break;
        default:
          outcome = { result: JSON.stringify({ erro: `tool desconhecida: ${name}` }), prices: [], terminal: false };
      }
    } catch (err) {
      this.logger.warn(`Tool ${name} falhou (lead ${leadId}): ${(err as Error).message}`);
      outcome = {
        result: JSON.stringify({ erro: 'falha interna ao consultar — transfira pro vendedor' }),
        prices: [],
        terminal: false,
      };
    }

    // toda tool call vai pra timeline (properties JSON) p/ auditoria
    await this.prisma.leadActivity
      .create({
        data: {
          leadId,
          type: LeadActivityType.NOTE,
          actorId: SDR_ACTOR,
          properties: {
            kind: 'sdr_tool_call',
            tool: name,
            input,
            result: outcome.result.slice(0, 2000),
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);

    return outcome;
  }

  // ── consultar_estoque ───────────────────────────────────────────────────────

  private async consultarEstoque(companyId: string, busca: string): Promise<ToolOutcome> {
    const terms = String(busca ?? '').trim().split(/\s+/).filter((t) => t.length >= 3).slice(0, 4);
    const products = await this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        type: 'FINISHED_GOOD' as any,
        salePrice: { not: null }, // só produto com preço público de tabela
        ...(terms.length
          ? {
              OR: terms.flatMap((t) => [
                { name: { contains: t, mode: 'insensitive' as const } },
                { description: { contains: t, mode: 'insensitive' as const } },
              ]),
            }
          : {}),
      },
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        salePrice: true,
        stockBalances: { select: { available: true } },
      },
      take: 5,
    });

    if (products.length === 0) {
      return {
        result: JSON.stringify({
          encontrados: 0,
          orientacao:
            'Nenhum produto de tabela bate com essa busca. NÃO invente: diga que vai confirmar o modelo com o vendedor e transfira se o cliente insistir.',
        }),
        prices: [],
        terminal: false,
      };
    }

    const items = products.map((p) => {
      const disponivel = p.stockBalances.reduce((sum, b) => sum + Number(b.available), 0);
      return {
        produtoId: p.id,
        sku: p.sku,
        nome: p.name,
        descricao: p.description?.slice(0, 160) ?? null,
        precoTabela: p.salePrice!.toFixed(2),
        disponibilidade: disponivel > 0 ? `${disponivel} em estoque` : 'sob encomenda',
      };
    });
    return {
      result: JSON.stringify({ encontrados: items.length, itens: items }),
      prices: items.map((i) => i.precoTabela),
      terminal: false,
    };
  }

  // ── consultar_prazo_entrega ─────────────────────────────────────────────────

  private async consultarPrazo(companyId: string, produtoId: string): Promise<ToolOutcome> {
    const product = await this.prisma.product.findFirst({
      where: { id: produtoId, companyId, isActive: true },
      select: {
        name: true,
        leadTimeDays: true,
        stockBalances: { select: { available: true } },
      },
    });
    if (!product) {
      return {
        result: JSON.stringify({ erro: 'produto não encontrado — confirme com consultar_estoque' }),
        prices: [],
        terminal: false,
      };
    }
    const disponivel = product.stockBalances.reduce((sum, b) => sum + Number(b.available), 0);
    const prazo =
      disponivel > 0
        ? 'pronta entrega (retirada/envio imediato)'
        : product.leadTimeDays && product.leadTimeDays > 0
          ? `${product.leadTimeDays} dias úteis (produção sob encomenda)`
          : 'sob consulta com o vendedor — NÃO prometa prazo, transfira';
    return {
      result: JSON.stringify({ produto: product.name, prazo }),
      prices: [],
      terminal: false,
    };
  }

  // ── registrar_qualificacao ──────────────────────────────────────────────────

  private async registrarQualificacao(
    companyId: string,
    leadId: string,
    q: {
      interesse: string;
      uso: string;
      cidade: string;
      prazo: string;
      formaPagamento: string;
      score: number;
      resumo: string;
    },
  ): Promise<ToolOutcome> {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        interest: q.interesse?.slice(0, 200) || undefined,
        sdrStatus: SdrLeadStatus.QUALIFIED,
        lastInteractionAt: new Date(),
        activities: {
          create: {
            type: LeadActivityType.NOTE,
            actorId: SDR_ACTOR,
            properties: { kind: 'sdr_qualification', ...q } as Prisma.InputJsonValue,
          },
        },
      },
    });
    return {
      result: JSON.stringify({ ok: true, orientacao: 'qualificação registrada — agora transfira pro vendedor' }),
      prices: [],
      terminal: false,
    };
  }

  // ── transferir_para_vendedor ────────────────────────────────────────────────

  private async transferir(
    companyId: string,
    leadId: string,
    motivo: string,
    resumoConversa: string,
  ): Promise<ToolOutcome> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: { id: true, name: true, phone: true, assignedToId: true, assignedTo: { select: { id: true, name: true } } },
    });
    if (!lead) return { result: JSON.stringify({ erro: 'lead não encontrado' }), prices: [], terminal: true };

    // lead já tem vendedor do rodízio da captação (F1.7); sem vendedor → pega o próximo disponível
    let seller = lead.assignedTo;
    if (!seller) {
      seller = await this.prisma.user.findFirst({
        where: { companyId, isActive: true, crmAvailable: true, role: { in: ['COMMERCIAL', 'STORE'] as any } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      if (seller) {
        await this.prisma.lead.update({
          where: { id: leadId },
          data: { assignedToId: seller.id, assignedAt: new Date() },
        });
      }
    }

    await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id: leadId },
        data: {
          sdrStatus: SdrLeadStatus.HANDOFF,
          lastInteractionAt: new Date(),
          activities: {
            create: {
              // resumo vira atividade DESTACADA na timeline (painel #524)
              type: LeadActivityType.ASSIGNMENT,
              actorId: SDR_ACTOR,
              properties: {
                kind: 'sdr_handoff',
                motivo,
                resumo: resumoConversa,
                toUserId: seller?.id ?? null,
                preview: `🤖→👤 ${motivo}: ${resumoConversa}`.slice(0, 300),
              } as Prisma.InputJsonValue,
            },
          },
        },
      }),
      // notificação in-app pro vendedor (sino de alertas)
      this.prisma.alert.create({
        data: {
          companyId,
          type: 'CRM_SDR_HANDOFF' as any,
          severity: 'WARNING' as any,
          title: `Lead quente da IA: ${lead.name ?? lead.phone ?? 'lead'}`,
          body: `${seller?.name ?? 'Sem vendedor'} — ${motivo}. ${resumoConversa}`.slice(0, 500),
          entityId: leadId,
          entityType: 'Lead',
        },
      }),
    ]);

    // web push "lead quente" no celular do vendedor (#568)
    this.eventEmitter.emit('crm.sdr.handoff', {
      leadId,
      companyId,
      toUserId: seller?.id ?? null,
      motivo,
    });

    return {
      result: JSON.stringify({
        ok: true,
        vendedor: seller?.name ?? 'a equipe',
        orientacao: 'mande agora UMA mensagem curta de despedida citando o vendedor',
      }),
      prices: [],
      terminal: true,
    };
  }

  // ── descartar_lead ──────────────────────────────────────────────────────────

  private async descartar(companyId: string, leadId: string, motivo: string): Promise<ToolOutcome> {
    const lostStage = await this.prisma.pipelineStage.findFirst({
      where: { companyId, type: 'LOST' as any, isActive: true },
      select: { id: true },
    });
    if (lostStage) {
      // reusa a regra unitária (motivo obrigatório, evento de kanban)
      await this.crm.changeStage(companyId, leadId, lostStage.id, SDR_ACTOR, `[SDR IA] ${motivo}`.slice(0, 300));
    }
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { sdrStatus: SdrLeadStatus.DISCARDED },
    });
    return {
      result: JSON.stringify({ ok: true, orientacao: 'lead descartado — não responda mais nada' }),
      prices: [],
      terminal: true,
    };
  }
}
