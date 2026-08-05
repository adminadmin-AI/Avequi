---
name: avecchi-voice
description: Voz e glossário da Avecchi para QUALQUER texto visível ao usuário no app (labels, títulos, botões, toasts, erros, empty states, confirmações, tooltips). Use SEMPRE que criar ou editar strings de UI no apps/web — o glossário e as fórmulas daqui são lei (épico #987, aprovado pelo Claudio em 04/08/2026).
---

# Avecchi Voice — voz e glossário do produto

Todo texto que o usuário lê no Avecchi segue este documento. Ele existe porque o
app nasceu com traduções literais do inglês ("Pagáveis" = *payables*) e mensagens
de máquina ("Não foi possível executar a ação"). A direção aprovada: **humano,
moderno e refinado — em português de verdade**, sem soar coloquial demais para
um ERP que emite nota fiscal.

## Princípios (nesta ordem)

1. **Claro na primeira leitura.** Se precisa reler, reescreva.
2. **Específico.** Confirma com o objeto ("Pedido #123 faturado"), nunca
   genérico ("Status atualizado").
3. **Humano sem ser íntimo.** "Não conseguimos salvar" (nós = o produto), nunca
   "Ops! 😅" nem "O sistema não pôde processar a requisição".
4. **Português.** Anglicismo só quando é o termo que o PRÓPRIO setor usa no
   Brasil (NF-e, CFOP, PIX, MRP, WMS, SLA, CRM, leads, funil, kanban). Na
   dúvida, traduza.
5. **Nada de jargão de engenharia.** O usuário nunca lê: endpoint, backend,
   fila, request, constraint, transição (de máquina de estados), tag XML solta,
   número de issue do GitHub.

## Regras de forma

- **Capitalização: frase normal.** Só a 1ª palavra e nomes próprios em
  maiúscula: "Contas a pagar", "Meus chamados", "Trilha de auditoria".
  (Siglas continuam siglas: "NF-e de entrada".)
- **Botões começam com verbo** no infinitivo: "Salvar", "Dar baixa",
  "Emitir NF-e". Nunca substantivo solto nem "(kill switch)" entre parênteses.
- **Nunca "&"** em texto de UI — sempre "e".
- **Sem abreviações truncadas** ("Próxima manut." → "Próxima manutenção").
- **Sem travessão (—) em texto de UI** (decisão Claudio 04/08). É a marca
  registrada de texto de máquina e quase sempre esconde um título preguiçoso.
  Alternativas, nesta ordem: campo de subtítulo do PageHeader ("MRP" +
  subtítulo "Planejamento de materiais"), parênteses ("Cobranças (boleto e
  PIX)"), dois-pontos, ou reescrever como frase ("Baixa registrada no título
  #482"). Exceção: intervalos numéricos/horários usam MEIA-RISCA ("seg–sex",
  "8h–18h") — isso é tipografia, não vício.
- Datas, moeda e número no padrão brasileiro.

## Fórmulas de mensagem

**Erro** — o que houve + por quê (se souber) + o que fazer:
> "Não conseguimos [ação + objeto]. [Motivo, se conhecido]. [Próximo passo]."
> Ex.: "Não conseguimos assumir a conversa. Tente de novo. Se continuar, avise o suporte."

**Sucesso** — objeto + o que aconteceu: "Baixa registrada no título #482".

**Confirmação destrutiva** — título com verbo + objeto; consequência em voz
ativa: "Cancelar o título? Você não vai conseguir desfazer isso."

**Empty state** — nunca só "Nenhum registro": diga o que é o espaço e convide
ao próximo passo. Ex.: "Nenhum lead por aqui. Ajuste os filtros ou aguarde
novas captações."

**Código técnico obrigatório** (rejeição SEFAZ, CNAB): mostre o código, mas
sempre com a explicação curada ao lado — nunca o código sozinho.

## Glossário canônico (de-para aprovado)

| Nunca escreva | Escreva |
|---|---|
| Pagáveis / Recebíveis | A pagar / A receber (menu) · Contas a pagar/receber (título de página) |
| Pagável, Conta, Lançamento (a entidade financeira) | **título** ("título a pagar", "título #482") |
| "Pagamento registrado" (na baixa) | "Baixa registrada no título #X" (nas duas carteiras) |
| Aging | Faixas de atraso |
| Forecast | Projeção ("Projeção financeira") |
| Budget / Drivers | Orçamento / Direcionadores ("Orçamento por direcionadores") |
| Provider | Instituição |
| Credenciadora (na UI geral) | Adquirente — "credenciadora" SÓ onde a NF-e exige o termo legal |
| Ordem de venda / OV | **Vendas** (módulo) · **pedido de venda** (entidade) · "Pedido #123" |
| Cotação (proposta a cliente) | **Orçamento** — "cotação" fica reservado a RFQ de compras |
| Inbox | Conversas |
| Dashboard | Painel |
| Analytics | Indicadores |
| SDR IA (sozinho) | Antonella (SDR IA) |
| Config | Ajustes |
| kill switch | "Desligar SDR" (e nunca vazar o termo em erro) |
| Lead time | Prazo de entrega |
| takeover | assumir a conversa |
| BOM (título de tela) | Estruturas (BOM) |
| Localizações (WMS) | Endereços |
| Tarefas WMS | Tarefas do depósito |
| armazém | depósito |
| Log de auditoria | Trilha de auditoria |
| Billing (portal ops) | Cobrança |
| Agendamentos (financeiro) | Pagamentos agendados |

**Mantidos de propósito** (jargão real do setor no BR): NF-e, DANFE, CFOP, CST,
NCM, DIFAL, PIX, boleto, MRP, WMS (na sigla, não em título de tela), SLA, CRM,
lead, funil, kanban, VPL, TIR, payback, WACC (com tooltip na 1ª ocorrência),
custeio por absorção, dar baixa, conciliação, alçada.

## Onde mexer (infra de mensagens)

- Fallbacks de erro: `erroDeAcao('<ação com objeto>', e)` de `@/lib/feedback`
  — não inventar "Erro ao X" novo em tela.
- `ErrorState` tem default humano — não sobrescrever com texto de máquina.
- Confirmações destrutivas: título verbo+objeto (com o valor quando houver).

## Gate no CI (voice-lint)

Este glossário é EXECUTADO: `apps/web/src/lib/voice-lint/` varre as strings de
`src/app` e `src/components` no vitest (roda no job `test` do CI) e QUEBRA o
build se um termo banido, travessão ou frase de máquina voltar. Falhou? Corrija
o texto por este documento; exceção consciente usa
`// voice-lint: ok (<motivo>)` na linha — sempre com motivo, revisável em PR.
Termo novo aposentado aqui deve entrar também no `BANNED_PATTERNS` de lá.

## Checklist antes de entregar tela nova

1. Algum termo da coluna "Nunca escreva"? 2. Botão começa com verbo?
3. Erro diz o que fazer? 4. Sucesso nomeia o objeto? 5. Capitalização de frase?
6. Vazou jargão de engenharia? 7. "&" em texto? 8. Travessão (—) em string de UI?
