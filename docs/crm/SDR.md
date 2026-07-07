# SDR IA — operação, guardrails e evals (F4 #521-525)

Agente Claude que faz o **primeiro atendimento** de leads no WhatsApp: responde em segundos, qualifica (modelo, uso, cidade, prazo, pagamento) consultando **estoque e preço reais do ERP**, e transfere quente pro vendedor. Quem fecha a venda é o humano.

## Como ligar

1. `ANTHROPIC_API_KEY` no `.env` da API (Railway). Sem a key o SDR fica inerte e o fluxo humano segue intocado.
2. Config CRM → seção "SDR IA" → **Ligado** (por loja). Modelo, trocas máximas e horário no mesmo lugar.
3. Supervisão em **SDR IA** no menu Comercial: métricas, custo, fila de descartes, incidentes e kill switch.

## Arquitetura (apps/api/src/modules/crm/sdr/)

| Arquivo | Papel |
|---|---|
| `sdr-agent.service.ts` | Loop de conversa: listeners de lead criado/mensagem recebida, takeover, circuit breaker |
| `sdr-prompt.ts` | System prompt **CONGELADO** (prompt caching — nunca interpolar nada) |
| `sdr-tools.ts` | 5 tools strict: estoque, prazo, qualificação, handoff, descarte |
| `sdr-guardrails.ts` | Validador de preço em código + janela de horário |
| `sdr-dashboard.service.ts` | Métricas/fila de revisão/incidentes do painel |

## Guardrails (defesa em profundidade)

- **Preço**: resposta com preço que não veio de tool na MESMA conversa → envio **bloqueado**, incidente logado, handoff. Pedido de desconto → handoff imediato (prompt) + validador impede contraproposta (código).
- **Trocas**: handoff garantido após N trocas da IA (default 12).
- **API fora**: circuit breaker (3 falhas → 5min) + handoff silencioso. O rodízio da captação **sempre** atribuiu vendedor — nenhuma mensagem quebrada chega ao cliente.
- **Takeover**: vendedor digitar na conversa silencia a IA na hora; botão "Assumir conversa" no painel do lead.
- **Kill switch**: 1 clique no painel SDR — tudo volta ao fluxo humano.

## ⚠️ GATE de mudança de prompt (#525)

**Alterou `sdr-prompt.ts` ou as descrições em `sdr-tools.ts`? Rodar a suíte de evals ANTES de mergear:**

```bash
cd apps/api && set -a && source .env && set +a && \
  ./node_modules/.bin/ts-node -r tsconfig-paths/register scripts/eval-sdr.ts
```

- ~30 cenários (lead quente, indeciso, caçador de desconto, spam, concorrente, irritado, técnica difícil, pede humano, mídia, gíria PR, anti-alucinação) contra o **agente real** com ERP mockado.
- **Gate de go-live: ≥ 90% de aprovação geral e 100% nos críticos** (desconto e pede-humano — zero tolerância).
- Relatório em `docs/crm/EVAL-SDR-<model>.md` (tabela + transcrições).

### Comparativo de modelos (decisão documentada com números)

```bash
./node_modules/.bin/ts-node -r tsconfig-paths/register scripts/eval-sdr.ts --model claude-opus-4-8
./node_modules/.bin/ts-node -r tsconfig-paths/register scripts/eval-sdr.ts --model claude-sonnet-5
./node_modules/.bin/ts-node -r tsconfig-paths/register scripts/eval-sdr.ts --model claude-haiku-4-5
```

Cada rodada gera seu `EVAL-SDR-<model>.md`. Decisão atual (#521, Claudio): **Opus 4.8** — qualidade em conversa de vendas > custo (~US$ 500-700/mês p/ 6k leads). O model é configurável por loja (Config CRM) p/ A/B em produção; o painel mostra o custo real do período.

## Custo e cache

- Todo turno grava tokens (input/output/cache) e USD estimado em `gdr_sdr_usage` → coluna de custo do painel.
- Critério do #521: **cache hit > 80% a partir da 2ª mensagem** — o painel mostra o hit rate. Se estiver baixo, algo interpolou conteúdo no system prompt (ver comentário em `sdr-prompt.ts`): o caching é prefix-match e um byte diferente invalida tudo.
