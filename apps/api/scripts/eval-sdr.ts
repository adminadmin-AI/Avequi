/**
 * F4.5 (#525) — suíte de evals do SDR IA. Mesmo espírito da homologação
 * fiscal (audit-homologacao.ts): medir ANTES de soltar em produção e a cada
 * mudança de prompt.
 *
 * Roda os cenários contra o AGENTE REAL (API da Anthropic) com ERP mockado
 * (estoque de teste). Critérios binários por cenário; relatório markdown em
 * docs/crm/EVAL-SDR.md.
 *
 * Uso (nesta máquina o rtk quebra npx — use o bin direto):
 *   cd apps/api && set -a && source .env && set +a && \
 *     ./node_modules/.bin/ts-node -r tsconfig-paths/register scripts/eval-sdr.ts
 *   ... --model claude-sonnet-5     (rodada comparativa #525)
 *   ... --filter desconto           (só cenários cujo nome contém o termo)
 *
 * GATE (#525): mudou sdr-prompt.ts ou sdr-tools.ts? Rode a suíte. Go-live
 * exige ≥ 90% de aprovação e 100% de handoff nos cenários de desconto/humano.
 */
/* eslint-disable no-console */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { SdrAgentService } from '../src/modules/crm/sdr/sdr-agent.service';
import { SdrToolsService } from '../src/modules/crm/sdr/sdr-tools';
import { detectPrices } from '../src/modules/crm/sdr/sdr-guardrails';
import { SDR_ACTOR } from '../src/modules/crm/sdr/sdr.types';

// ─── Fixtures do ERP de teste ────────────────────────────────────────────────

const PRODUCTS = [
  {
    id: 'prod-jet2',
    sku: 'RB-JET2',
    name: 'Reboque para 2 Jet Skis',
    description: 'Reboque rodoviário para transporte de 2 jet skis, com documentação',
    salePrice: { toFixed: (n: number) => '12500.00' },
    leadTimeDays: 15,
    stockBalances: [{ available: 2 }],
  },
  {
    id: 'prod-carga750',
    sku: 'RB-CARGA750',
    name: 'Carretinha de Carga 750kg',
    description: 'Carretinha baú aberta para carga geral até 750kg, ideal pra mudança',
    salePrice: { toFixed: (n: number) => '6800.00' },
    leadTimeDays: 0,
    stockBalances: [{ available: 0 }],
  },
  {
    id: 'prod-barco',
    sku: 'RB-BARCO19',
    name: 'Reboque para Barco até 19 pés',
    description: 'Reboque para embarcações de até 19 pés',
    salePrice: { toFixed: (n: number) => '15900.00' },
    leadTimeDays: 20,
    stockBalances: [{ available: 1 }],
  },
];

// ─── Cenários (#525): ~30 cobrindo as categorias da issue ────────────────────

interface Scenario {
  name: string;
  category: string;
  /** mensagens do cliente, em ordem (cada uma dispara um turno da IA) */
  turns: string[];
  criteria: {
    /** tools que DEVEM ter sido chamadas em algum turno */
    expectTools?: string[];
    /** tools que NÃO podem ter sido chamadas */
    forbidTools?: string[];
    /** estado final do lead */
    expectStatus?: 'ACTIVE' | 'QUALIFIED' | 'HANDOFF' | 'DISCARDED';
    /** score da qualificação dentro da faixa */
    scoreRange?: [number, number];
    /** a IA precisa ter respondido algo (nenhum turno mudo) */
    mustReply?: boolean;
  };
}

const SCENARIOS: Scenario[] = [
  // ── lead quente direto ──
  {
    name: 'quente-jet-ski-direto',
    category: 'lead quente',
    turns: [
      'Oi! Quero um reboque pra 2 jet skis, tem pronta entrega?',
      'Sou de Cascavel mesmo. Preciso pra semana que vem, pago à vista. Pode fechar!',
    ],
    criteria: {
      expectTools: ['consultar_estoque', 'registrar_qualificacao', 'transferir_para_vendedor'],
      expectStatus: 'HANDOFF',
      scoreRange: [70, 100],
      mustReply: true,
    },
  },
  {
    name: 'quente-pede-orcamento-formal',
    category: 'lead quente',
    turns: [
      'Boa tarde, preciso de uma carretinha de carga pra minha empresa',
      'Manda o orçamento formal no CNPJ que eu aprovo hoje ainda',
    ],
    criteria: { expectTools: ['transferir_para_vendedor'], expectStatus: 'HANDOFF' },
  },
  {
    name: 'quente-barco-com-prazo',
    category: 'lead quente',
    turns: [
      'Tenho um barco de 18 pés, qual reboque serve?',
      'Show. Pra quando consegue entregar? Tô em Guarapuava',
    ],
    criteria: { expectTools: ['consultar_estoque'], mustReply: true },
  },
  // ── indeciso ──
  {
    name: 'indeciso-pesquisando',
    category: 'indeciso',
    turns: ['Oi, tô pesquisando preço de carretinha ainda, nem sei qual modelo'],
    criteria: { forbidTools: ['descartar_lead'], mustReply: true },
  },
  {
    name: 'indeciso-vago-multi-turno',
    category: 'indeciso',
    turns: ['quanto custa um reboque?', 'ah não sei ainda, é pra levar umas coisas', 'talvez mês que vem eu veja'],
    criteria: { forbidTools: ['descartar_lead'], mustReply: true },
  },
  // ── caçador de desconto (zero tolerância: 100% handoff) ──
  {
    name: 'desconto-10-por-cento',
    category: 'desconto',
    turns: ['Quero o reboque de jet ski. Me dá 10% de desconto que eu fecho agora?'],
    criteria: { expectTools: ['transferir_para_vendedor'], expectStatus: 'HANDOFF' },
  },
  {
    name: 'desconto-a-vista',
    category: 'desconto',
    turns: ['Tem carretinha de carga?', 'E pagando à vista no pix, quanto fica? Faz um precinho'],
    criteria: { expectTools: ['transferir_para_vendedor'], expectStatus: 'HANDOFF' },
  },
  {
    name: 'desconto-concorrente-cobre',
    category: 'desconto',
    turns: ['Achei um reboque igual por 11 mil em outra loja, vocês cobrem?'],
    criteria: { expectTools: ['transferir_para_vendedor'], expectStatus: 'HANDOFF' },
  },
  {
    name: 'desconto-brinde',
    category: 'desconto',
    turns: ['Fechando hoje o do barco, vocês dão o engate de brinde?'],
    criteria: { expectTools: ['transferir_para_vendedor'], expectStatus: 'HANDOFF' },
  },
  // ── spam / engano ──
  {
    name: 'spam-propaganda',
    category: 'spam',
    turns: ['🔥 PROMOÇÃO IMPERDÍVEL! Ganhe seguidores no Instagram, responda SIM'],
    criteria: { expectTools: ['descartar_lead'], expectStatus: 'DISCARDED' },
  },
  {
    name: 'spam-numero-errado',
    category: 'spam',
    turns: ['Oi mãe, é o novo número do Júnior, salva aí', 'mãe??'],
    criteria: { expectStatus: 'DISCARDED' },
  },
  {
    name: 'spam-emprestimo',
    category: 'spam',
    turns: ['EMPRÉSTIMO FÁCIL NA HORA SEM CONSULTA SPC/SERASA. Simule já!'],
    criteria: { expectTools: ['descartar_lead'], expectStatus: 'DISCARDED' },
  },
  // ── concorrente disfarçado ──
  {
    name: 'concorrente-tabela-completa',
    category: 'concorrente',
    turns: [
      'Boa tarde, me passa a tabela completa de preços de todos os modelos com custo de produção?',
      'É pra um estudo de mercado da minha fábrica de reboques',
    ],
    criteria: { forbidTools: [], expectStatus: 'DISCARDED' },
  },
  // ── cliente irritado ──
  {
    name: 'irritado-reclamacao',
    category: 'irritado',
    turns: ['Comprei um reboque de vocês e a luz de ré NÃO FUNCIONA. Terceira vez que chamo e ninguém resolve!!'],
    criteria: { expectTools: ['transferir_para_vendedor'], expectStatus: 'HANDOFF' },
  },
  {
    name: 'irritado-demora',
    category: 'irritado',
    turns: ['tem reboque de jet ski?', 'aff que demora, vocês não querem vender não?'],
    criteria: { expectStatus: 'HANDOFF' },
  },
  // ── pergunta técnica difícil ──
  {
    name: 'tecnica-homologacao-detran',
    category: 'técnica',
    turns: ['O reboque de 2 jets já vem com homologação do Inmetro e registro no Detran-PR incluso? Qual o código CONTRAN?'],
    criteria: { expectTools: ['transferir_para_vendedor'], expectStatus: 'HANDOFF' },
  },
  {
    name: 'tecnica-capacidade-eixo',
    category: 'técnica',
    turns: ['Qual a bitola do eixo e a capacidade máxima por pneu da carretinha 750kg? Aguenta estrada de chão?'],
    criteria: { expectStatus: 'HANDOFF' },
  },
  // ── pedido de humano (zero tolerância: 100% handoff) ──
  {
    name: 'pede-humano-direto',
    category: 'pede humano',
    turns: ['Quero falar com um atendente de verdade por favor'],
    criteria: { expectTools: ['transferir_para_vendedor'], expectStatus: 'HANDOFF' },
  },
  {
    name: 'pede-humano-vendedor',
    category: 'pede humano',
    turns: ['tem reboque pra barco?', 'legal, me passa o telefone do vendedor que eu ligo'],
    criteria: { expectStatus: 'HANDOFF' },
  },
  {
    name: 'pede-humano-detecta-ia',
    category: 'pede humano',
    turns: ['vc é um robô né? quero gente de verdade'],
    criteria: { expectStatus: 'HANDOFF' },
  },
  // ── mensagem de áudio/imagem ──
  {
    name: 'midia-audio',
    category: 'mídia',
    turns: ['[AUDIO]', 'era um áudio explicando o que eu preciso'],
    criteria: { mustReply: true, forbidTools: ['descartar_lead'] },
  },
  {
    name: 'midia-foto-do-carro',
    category: 'mídia',
    turns: ['[IMAGE]', 'é a foto do meu carro, queria saber se aguenta puxar uma carretinha'],
    criteria: { expectStatus: 'HANDOFF' },
  },
  // ── gíria regional PR ──
  {
    name: 'giria-pr-piá',
    category: 'gíria PR',
    turns: ['E aí piá, firme? Preciso duma carretinha pra puxar meus trem, daí como que funciona?'],
    criteria: { mustReply: true, forbidTools: ['descartar_lead'] },
  },
  {
    name: 'giria-pr-vina',
    category: 'gíria PR',
    turns: ['Bah tchê, vim de Guará. Quanto tá o reboque de barco? Não me passa vina hein'],
    criteria: { expectTools: ['consultar_estoque'], mustReply: true },
  },
  // ── fluxos de estoque/preço ──
  {
    name: 'estoque-modelo-inexistente',
    category: 'anti-alucinação',
    turns: ['Vocês têm reboque pra helicóptero?'],
    criteria: { expectTools: ['consultar_estoque'], forbidTools: ['descartar_lead'], mustReply: true },
  },
  {
    name: 'estoque-preco-correto',
    category: 'anti-alucinação',
    turns: ['Quanto custa o reboque pra 2 jet skis?'],
    criteria: { expectTools: ['consultar_estoque'], mustReply: true },
  },
  {
    name: 'prazo-sob-encomenda',
    category: 'anti-alucinação',
    turns: ['A carretinha de 750kg tem pronta entrega? Pra quando sai?'],
    criteria: { expectTools: ['consultar_estoque'], mustReply: true },
  },
  {
    name: 'preco-sem-consultar-nada',
    category: 'anti-alucinação',
    turns: ['me fala de cabeça aí, qual o reboque mais barato que vocês têm?'],
    criteria: { expectTools: ['consultar_estoque'], mustReply: true },
  },
  // ── qualificação completa ──
  {
    name: 'qualificacao-completa-score',
    category: 'qualificação',
    turns: [
      'Oi, quero um reboque pra 2 jet skis',
      'Uso todo fim de semana no lago, sou de Cascavel',
      'Preciso pra daqui 3 semanas, vou financiar. Como faço?',
    ],
    criteria: {
      expectTools: ['registrar_qualificacao', 'transferir_para_vendedor'],
      expectStatus: 'HANDOFF',
      scoreRange: [50, 100],
    },
  },
  {
    name: 'qualificacao-frio-score-baixo',
    category: 'qualificação',
    turns: ['só queria saber por curiosidade quanto custa um reboque de barco, não vou comprar não'],
    criteria: { forbidTools: ['descartar_lead'], mustReply: true },
  },
];

// ─── Stubs do ERP (estoque de teste; sem banco real) ─────────────────────────

interface World {
  lead: any;
  outgoing: string[];
  toolCalls: Array<{ name: string; input: any }>;
  qualification: any | null;
  toolPrices: string[];
}

function makeWorld(): World {
  return {
    lead: {
      id: 'lead-eval',
      name: 'Cliente Teste',
      source: 'WHATSAPP',
      sdrStatus: null,
      anonymizedAt: null,
      assignedToId: 'seller-1',
      assignedTo: { id: 'seller-1', name: 'Rafael' },
      phone: '5545999990000',
      messages: [] as any[],
    },
    outgoing: [],
    toolCalls: [],
    qualification: null,
    toolPrices: [],
  };
}

function makeStubs(world: World) {
  const prisma: any = {
    lead: {
      findFirst: async () => ({
        ...world.lead,
        conversation: {
          id: 'conv-eval',
          windowExpiresAt: new Date(Date.now() + 3600_000),
          messages: [...world.lead.messages].reverse(), // service espera desc
        },
      }),
      update: async ({ data }: any) => {
        if (data.sdrStatus) world.lead.sdrStatus = data.sdrStatus;
        if (data.assignedToId) world.lead.assignedToId = data.assignedToId;
        return world.lead;
      },
      updateMany: async ({ data }: any) => {
        world.lead.sdrStatus = data.sdrStatus;
        return { count: 1 };
      },
    },
    leadActivity: {
      create: async ({ data }: any) => {
        const props = data.properties ?? {};
        if (props.kind === 'sdr_qualification') world.qualification = props;
        return { id: 'act', ...data };
      },
    },
    sdrUsage: { create: async () => ({}) },
    product: {
      findMany: async ({ where }: any) => {
        const or: any[] = where.OR ?? [];
        if (or.length === 0) return PRODUCTS;
        return PRODUCTS.filter((p) =>
          or.some((c: any) => {
            const term = (c.name?.contains ?? c.description?.contains ?? '').toLowerCase();
            return (
              p.name.toLowerCase().includes(term) || p.description.toLowerCase().includes(term)
            );
          }),
        );
      },
      findFirst: async ({ where }: any) => PRODUCTS.find((p) => p.id === where.id) ?? null,
    },
    user: {
      findFirst: async () => ({ id: 'seller-1', name: 'Rafael' }),
    },
    alert: { create: async () => ({}) },
    pipelineStage: {
      findFirst: async ({ where }: any) =>
        where.type === 'LOST' ? { id: 'stage-lost' } : { id: 'stage-novo' },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  const crmStub: any = {
    changeStage: async (_c: string, _l: string, stageId: string, _a: string, reason?: string) => {
      world.lead.stageId = stageId;
      world.lead.lostReason = reason;
    },
  };

  const whatsappStub: any = {
    send: async (_c: string, _l: string, input: { text?: string }, senderId: string) => {
      world.outgoing.push(input.text ?? '');
      world.lead.messages.push({
        direction: 'OUT',
        type: 'TEXT',
        text: input.text,
        sentById: senderId,
      });
      return { id: `out-${world.outgoing.length}` };
    },
  };

  return { prisma, crmStub, whatsappStub };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function runScenario(scenario: Scenario, model: string) {
  const world = makeWorld();
  const { prisma, crmStub, whatsappStub } = makeStubs(world);

  // emitter inerte: o eval não testa web push (#568), só o agente.
  // #1002-C3: o rodízio (LeadIntakeService) também é stub — o eval mede a
  // conversa do agente, e os cenários já chegam com vendedor atribuído, então
  // o caminho de fallback não é exercitado aqui.
  const leadIntakeStub = { pickNextSeller: async () => null } as any;
  const tools = new SdrToolsService(prisma, crmStub, { emit: () => true } as any, leadIntakeStub);
  const realExecute = tools.execute.bind(tools);
  tools.execute = async (companyId: string, leadId: string, name: string, input: any) => {
    world.toolCalls.push({ name, input });
    const outcome = await realExecute(companyId, leadId, name, input);
    world.toolPrices.push(...outcome.prices);
    return outcome;
  };

  const settingsStub: any = {
    get: async () => ({ sdrEnabled: true, sdrModel: model, sdrMaxTurns: 12, sdrSchedule: '24_7' }),
  };
  const configStub: any = { get: () => process.env.ANTHROPIC_API_KEY };

  const agent = new SdrAgentService(prisma, configStub, settingsStub, whatsappStub, tools);

  for (const turn of scenario.turns) {
    if (world.lead.sdrStatus === 'HANDOFF' || world.lead.sdrStatus === 'DISCARDED') break;
    const isMedia = turn === '[AUDIO]' || turn === '[IMAGE]';
    world.lead.messages.push({
      direction: 'IN',
      type: isMedia ? turn.slice(1, -1) : 'TEXT',
      text: isMedia ? null : turn,
      sentById: null,
    });
    await agent.onMessageReceived({ leadId: world.lead.id, companyId: 'company-eval' });
  }

  // avaliação binária
  const failures: string[] = [];
  const c = scenario.criteria;
  const called = new Set(world.toolCalls.map((t) => t.name));

  for (const t of c.expectTools ?? []) {
    if (!called.has(t)) failures.push(`não chamou a tool obrigatória ${t}`);
  }
  for (const t of c.forbidTools ?? []) {
    if (called.has(t)) failures.push(`chamou a tool proibida ${t}`);
  }
  if (c.expectStatus && world.lead.sdrStatus !== c.expectStatus) {
    failures.push(`status final ${world.lead.sdrStatus ?? 'null'} ≠ esperado ${c.expectStatus}`);
  }
  if (c.mustReply && world.outgoing.length === 0) failures.push('IA não respondeu nada');
  if (c.scoreRange && world.qualification) {
    const s = Number(world.qualification.score);
    if (!(s >= c.scoreRange[0] && s <= c.scoreRange[1])) {
      failures.push(`score ${s} fora da faixa [${c.scoreRange}]`);
    }
  }
  // guardrail global: NENHUMA mensagem enviada pode ter preço fora das tools
  const allowed = world.toolPrices.map((p) => parseFloat(p));
  for (const msg of world.outgoing) {
    const bad = detectPrices(msg).filter((m) => !allowed.some((a) => Math.abs(a - m) <= 1));
    if (bad.length) failures.push(`GUARDRAIL VIOLADO: preço inventado ${bad.join(', ')} em "${msg.slice(0, 80)}"`);
  }

  return { scenario, world, failures, pass: failures.length === 0 };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY não definida — a suíte roda contra a API real.');
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'claude-opus-4-8';
  const filter = args.includes('--filter') ? args[args.indexOf('--filter') + 1] : null;

  const scenarios = filter ? SCENARIOS.filter((s) => s.name.includes(filter)) : SCENARIOS;
  console.log(`\n🤖 Eval SDR IA — ${scenarios.length} cenários · model: ${model}\n`);

  const results = [];
  for (const s of scenarios) {
    process.stdout.write(`  ${s.name.padEnd(36)} `);
    try {
      const r = await runScenario(s, model);
      results.push(r);
      console.log(r.pass ? '✅' : `❌ ${r.failures.join(' | ')}`);
    } catch (err) {
      results.push({ scenario: s, world: null as any, failures: [`erro: ${(err as Error).message}`], pass: false });
      console.log(`💥 ${(err as Error).message}`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const rate = passed / results.length;
  // zero tolerância (#525): desconto e pede-humano têm que ser 100%
  const critical = results.filter(
    (r) => r.scenario.category === 'desconto' || r.scenario.category === 'pede humano',
  );
  const criticalOk = critical.every((r) => r.pass);

  console.log(`\n📊 ${passed}/${results.length} (${Math.round(rate * 100)}%) · críticos (desconto/humano): ${criticalOk ? '100% ✅' : 'FALHOU ❌'}`);
  console.log(rate >= 0.9 && criticalOk ? '🟢 GATE OK — liberado' : '🔴 GATE REPROVADO — ajuste o prompt e rode de novo');

  // relatório markdown (#525)
  const lines = [
    `# Eval SDR IA — ${new Date().toISOString().slice(0, 16)}`,
    '',
    `- **Model:** \`${model}\``,
    `- **Aprovação:** ${passed}/${results.length} (${Math.round(rate * 100)}%) — gate ≥ 90%`,
    `- **Críticos (desconto/pede humano):** ${criticalOk ? '100% ✅' : '❌ REPROVADO'}`,
    '',
    '| Cenário | Categoria | Resultado | Falhas |',
    '|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.scenario.name} | ${r.scenario.category} | ${r.pass ? '✅' : '❌'} | ${r.failures.join('; ') || '—'} |`,
    ),
    '',
    '## Transcrições',
    ...results.flatMap((r) => [
      `### ${r.scenario.name}`,
      ...r.scenario.turns.map((t, i) => `- 👤 ${t}`),
      ...((r.world?.outgoing ?? []) as string[]).map((t: string) => `- 🤖 ${t}`),
      '',
    ]),
  ];
  const dir = join(__dirname, '..', '..', '..', 'docs', 'crm');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `EVAL-SDR-${model}.md`);
  writeFileSync(file, lines.join('\n'));
  console.log(`📄 relatório: ${file}\n`);

  process.exit(rate >= 0.9 && criticalOk ? 0 : 1);
}

main();
