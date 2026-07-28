import type Anthropic from '@anthropic-ai/sdk';

/**
 * V2.6 (#573) — resumo IA da conversa no takeover humano.
 *
 * Prompt PRÓPRIO e CURTO, separado do SDR (sdr-prompt.ts tem gate de evals
 * #525 — NÃO reusar aquele). Aqui não há venda nem tools de ERP: só condensar
 * uma conversa (possivelmente 100% humana e longa) pro vendedor que assume
 * entender o contexto em segundos, sem reler tudo.
 *
 * Modelo barato de propósito (claude-haiku-4-5): é sumarização, não raciocínio.
 */
export const LEAD_SUMMARY_SYSTEM_PROMPT = `Você resume conversas de atendimento comercial da GDR Reboques (fabricante de reboques e carretinhas) para o vendedor que vai assumir o atendimento.

Leia a conversa de WhatsApp e chame a tool registrar_resumo com:
- um resumo objetivo em 3 a 4 frases curtas (quem é o cliente, o que quer, em que ponto está a conversa e qual o próximo passo);
- os dados que o cliente revelou ao longo da conversa: cidade, o que precisa (modelo/uso do reboque), prazo e forma de pagamento.

Regras:
- Só registre um dado se ele apareceu na conversa. Não deduza, não invente, não complete com suposição. Dado que não apareceu fica vazio.
- Português brasileiro direto, sem formalidade e sem markdown. Foque no que ajuda o vendedor a continuar a venda.
- Não repita a conversa mensagem a mensagem: sintetize.`;

/**
 * Saída estruturada forçada (tool_choice): garante um objeto parseável em UMA
 * chamada, sem parsing frágil de JSON em texto livre. Mesmo estilo strict das
 * tools do SDR (sdr-tools.ts).
 */
export const LEAD_SUMMARY_TOOL: Anthropic.Messages.Tool = {
  name: 'registrar_resumo',
  description:
    'Registra o resumo da conversa e os dados descobertos do cliente. Chame exatamente uma vez, sempre.',
  input_schema: {
    type: 'object',
    properties: {
      resumo: {
        type: 'string',
        description: 'Resumo objetivo da conversa em 3 a 4 frases curtas.',
      },
      cidade: { type: 'string', description: 'Cidade do cliente (vazio se não apareceu).' },
      necessidade: {
        type: 'string',
        description: 'O que o cliente precisa: modelo/categoria e uso do reboque (vazio se não apareceu).',
      },
      prazo: { type: 'string', description: 'Pra quando o cliente precisa (vazio se não apareceu).' },
      pagamento: {
        type: 'string',
        description: 'Forma de pagamento pretendida: à vista, cartão, financiamento (vazio se não apareceu).',
      },
    },
    required: ['resumo'],
    additionalProperties: false,
  },
};

export interface LeadSummaryResult {
  resumo: string;
  cidade?: string | null;
  necessidade?: string | null;
  prazo?: string | null;
  pagamento?: string | null;
}
