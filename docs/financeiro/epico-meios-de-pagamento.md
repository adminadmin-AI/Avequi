# Épico — Meios de pagamento: cartão de crédito, recebíveis e conciliação

> Épico **#583** · issues **#584–#590** + Fluxo B **#595/#596/#597** · board [projects/7](https://github.com/users/adminadmin-AI/projects/7/views/1)
> Origem: análise do fluxo financeiro (07/07/2026).

## 1. Problema

O faturamento gera **1 título único com vencimento fixo de 30 dias**, ignorando a forma de pagamento e o prazo escolhidos na venda. Isso distorce o contas-a-receber e a projeção de caixa — crítico porque **cartão de crédito é a maioria da operação da GDR** e hoje é tratado igual a boleto (título cheio contra o cliente, quando na real quem paga é a adquirente, líquido, em D+).

## 2. Estado atual (código)

| Ponto | Local | Comportamento |
|-------|-------|---------------|
| Geração do título | `finance.listener.ts:23` → `finance.service.ts:23` | recebe só `companyId/salesOrderId/amount` |
| Vencimento | `finance.service.ts:39` | `hoje + 30` **fixo**, 1 `FinancialEntry` |
| Parcelamento | `finance.service.ts:266` (`createInstallments`) | existe, mas **manual** — não é chamado no faturamento |
| Forma de pagamento | `schema:941` (`SalesOrder.paymentMethod`) | só alimenta `detPag` da NF-e, **não molda os títulos** |
| Enum | `schema:1166` (`PaymentMethod`) | `CARTAO` genérico — sem crédito/débito, bandeira, adquirente, parcelas, MDR, prazo |
| Boleto/PIX | `banking.controller.ts:114-154` | **stubs** (`NotImplementedException`); sem CNAB240 |
| Fiscal | `fiscal-mapper.ts:493,526` | `forma_pagamento` mapeado, **sem grupo `card`** (tBand/cAut) |
| Fluxo de venda | `sales.service.ts` | **obriga** separação+conferência; `invoiceOrder` exige `pickingOrder = DONE`; **sem gate de pagamento** |

## 3. Conceito-chave

No cartão, **o devedor do título é a adquirente (Cielo/Rede/Stone), não o cliente**: recebível pelo **valor líquido** (bruto − MDR), na **data de liquidação** (crédito à vista ≈ D+30; parcelado = 1 parcela/mês), com a MDR virando **despesa financeira**.

## 4. Duas frentes de venda

- **A — Fábrica (com separação):** `pedido → reserva → confirma → separação (escolhe chassi) → conferência (re-scan) → fatura → título`. Inclui a perna de **transferência fábrica→filial**: `StoreTransfer` dispara `TRANSFER_DISPATCHED_EVENT` → NF-e de remessa **CFOP 5152/6152**. O `finance.listener` **não** ouve transferência → **remessa não gera título** (correto). A filial dá entrada no estoque.
- **B — Balcão da filial (venda direta):** o vendedor fecha a venda com o cliente presente, **sem separação**, escaneia o chassi **no pedido**, escolhe parcelas e passa o cartão; **TEF integrado autoriza → dispara o faturamento**. **Não existe hoje** (issues #595/#596/#597).

## 5. Desenho (boa prática)

- **(a)** Modelo `SalesPayment` — plano de pagamento por venda (1+ formas; `detPag` é lista) + estado de autorização (PENDING/AUTHORIZED/DENIED, authCode/NSU/bandeira).
- **(b)** Cadastro de adquirentes + tabela de taxas **MDR** por bandeira/modalidade/parcelas + **prazo de liquidação**.
- **(c)** Refatorar a geração de títulos no faturamento (boleto→N parcelas por prazo contra o cliente; cartão→N recebíveis contra a adquirente, líquidos, D+n; MDR como despesa). No balcão, o recebível nasce na **company da filial**. Corrige o bug do "30 dias fixo".
- **(d)** Conciliação de cartão (arquivo/API da adquirente; baixa dos títulos; taxa divergente, antecipação, chargeback).
- **(e)** Fiscal: grupo `card` na NF-e (tPag 03/04, **`tpIntegra=1`** TEF integrado, `tBand`, `cAut` vindos do gate).
- **Fluxo B:** venda balcão sem separação (#595) + **gate de autorização TEF** antes do faturamento (#596) + verificação da perna de transferência (#597).

## 6. Faseamento por prioridade

| Fase | Issues | Entrega |
|------|--------|---------|
| **1 — MVP** | #584 (a) · #585 (b) · #586 (c) · #587 (e) | Plano de pagamento + adquirente/taxa + recebível líquido com data certa + MDR como despesa (baixa manual). Corrige o bug dos 30 dias fixos |
| **1 — Fluxo B** | #595 · #596 · #597 | Venda balcão sem separação + gate de autorização TEF + verificação da transferência |
| **2 — Automação** | #588 (d) | Conciliação automática, antecipação, chargeback |
| **3 — Boleto/PIX/CNAB** | #589 · #590 | Boleto/PIX real via API + remessa CNAB240 |

## 7. Decisões e inputs

- ✅ **Autorização de cartão:** TEF/gateway **integrado** ao ERP (`tpIntegra=1`) — autorização automática é gate do faturamento.
- ✅ **`debtorType: CUSTOMER | ACQUIRER`** no título (ver §8) — decisão derivada da convivência com os Sprints 1–2.
- ⏳ **Adquirentes/bandeiras** que a GDR usa e as taxas contratadas (seed da issue #585).
- ⏳ **Qual TEF/gateway** integrar (define o adapter do #596).

## 8. Convivência com os Sprints 1–2 do financeiro (implantados 07/07 — PRs #578–#600)

Enquanto este épico era desenhado, outra sessão implantou os Sprints 1–2 da consultoria financeira (KPIs, fluxo 13 semanas, conciliação OFX, régua de cobrança, PDD, política de crédito, alçadas de desconto, book gerencial). **Nada colide estruturalmente** (`FinancialEntry` não mudou), mas os serviços novos **assumem que todo recebível é dívida do cliente** — premissa que o item (c) quebra ao criar títulos contra a adquirente.

**Decisão de design:** o título ganha **`debtorType: CUSTOMER | ACQUIRER`** (+ `acquirerId`), e 4 consumidores filtram por ele (detalhado no #586):

| Consumidor | Local | Risco sem o filtro |
|---|---|---|
| Régua de cobrança | `collection-rule.service.ts:127-167` | cobra e **bloqueia o cliente** (`autoBlock`) por atraso de liquidação da adquirente |
| Limite de crédito | `sales.service.ts:257` · `customer.service.ts:197` | cartão autorizado **consome o limite** do cliente que já pagou |
| PDD | `provision.service.ts:79` | provisiona risco-adquirente na régua de risco-cliente |
| KPI PMR | `finance-kpi.service.ts:187` | D+30/60 do cartão desfigura o prazo médio de recebimento |

**Sinergias:** fluxo 13 semanas (#579) e conciliação OFX (#580) passam a operar com dados reais quando o #586 corrigir vencimentos/valores líquidos; a conciliação de cartão (#588) cobre o **lado adquirente** e complementa o match OFX (lado banco); a venda balcão (#595) compõe com as alçadas de desconto (#599) e o `billingBlocked`.
