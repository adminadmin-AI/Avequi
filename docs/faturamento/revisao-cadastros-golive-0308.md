# Revisão de Cadastros — GO LIVE 03/08/2026 (Reforma Tributária)

**Data da revisão:** 05/07/2026 · **Base:** quadro de planejamento + schema atual do Avequi + validações de homologação (18 NF-e autorizadas, auditoria PR #444)

Legenda de prioridade:
- 🔴 **P0** — bloqueia o go-live de 03/08
- 🟠 **P1** — primeira semana pós-go-live
- 🟡 **P2** — evolução (paridade com ERPs de mercado)

---

## 1. CLIENTE

**Estado atual:** cadastro funcional (PF/PJ, documento, endereço completo + IBGE, IE, ativo). Análise completa vs Omie feita em 05/07 → issues **#474 (P1), #475 (P2), #476 (P3)**.

| Gap | Reforma? | Prio |
|---|---|---|
| Indicador de contribuinte ICMS explícito (`indIeDest`) — hoje inferido, causou rejeição 234 | Indireto (DIFAL correto) | 🔴 #474 |
| Flag produtor rural + optante Simples | Não | 🔴 #474 |
| Endereço de entrega 1:N (grupo `<entrega>` da NF-e) | Não | 🟠 #474 |
| Razão social × fantasia, e-mail fiscal | Não | 🟠 #474 |
| Limite de crédito, bloqueio de faturamento, padrões comerciais | Não | 🟡 #475 |

**Reforma:** nenhum campo novo exigido no cliente para IBS/CBS 2026.

---

## 2. FORNECEDOR ⚠️ (o cadastro mais defasado do sistema)

**Estado atual:** só `name, cnpj, email, phone, leadTimeDays` — sem IE, sem endereço, sem regime tributário. Muito abaixo de qualquer ERP de mercado.

| Gap | Por quê | Prio |
|---|---|---|
| **Regime tributário do fornecedor** (Simples/Presumido/Real) | **REFORMA**: o crédito de IBS/CBS na compra depende do regime do fornecedor (Simples gera crédito limitado). Em 2026 é informativo, mas o dado precisa começar a ser coletado | 🟠 |
| IE + indicador contribuinte | Crédito de ICMS na entrada, conferência da NF-e de compra (3-way match já existe) | 🟠 |
| Endereço completo + IBGE | Frete de compra, conferência inbound-NFe | 🟠 |
| Razão social × fantasia, contato, condição de pagamento padrão | Operacional compras (módulo purchase/RFQ já existe) | 🟡 |
| Dados bancários (banco/agência/conta/PIX) | Pagamento a fornecedor — o módulo banking (#296) já tem estrutura | 🟡 |

---

## 3. CFOP (venda + compra + transferência)

**Estado atual:** `TaxRule` é o cadastro de fato — 22 regras da GDR no banco (12 operações + 10 reboque/UF), validadas em homologação (CFOPs 5101/6101/5152/6152/1202/2101/5915/1916/5911/5910...).

| Gap | Prio |
|---|---|
| CFOPs de industrialização por terceiros (remessa/retorno beneficiamento 5901/5902/5124) — GDR terceiriza alguma etapa? Confirmar com operação | 🟡 |
| Devolução interestadual (2202) — só temos 1202 interna | 🟠 |
| **Reforma:** CFOP convive com cClassTrib em 2026; a partir de 2027 o cClassTrib assume — nossa tabela de-para (TaxRule tem os dois campos) já está pronta pra transição | ✅ |

---

## 4. NCM

**Estado atual:** issue **#449** — 17 produtos acabados (reboques) com NCM 87163900 + RENAVAM ✅. **295 produtos sem NCM** (MP, componentes, semiacabados).

| Gap | Prio |
|---|---|
| NCM dos 295 itens de estoque — **contador** (pistas: NCMs históricos de compra — chapas 72xx, pneus 4011, parafusos 7318) | 🟠 (não bloqueia venda; bloqueia entrada de NF-e de compra com validação) |
| Validação de NCM no cadastro (8 dígitos + existência na tabela TIPI) — ERPs de mercado validam | 🟡 |
| CEST no produto (se revender peças com ST) — reboque não tem ST | 🟡 |

---

## 5. TRIBUTOS (atuais)

**Estado atual:** motor completo ICMS/IPI/PIS/COFINS/DIFAL por NCM/UF, CSTs reais validados contra NF-e #14236 (PIS 49/COFINS 99, IPI 51), 55+ testes.

| Gap | Prio |
|---|---|
| **FCP do UF destino** (SP/RJ = 2%) — mandamos 0 fixo; nota autorizada mas fiscalmente incorreta (**#445**) | 🔴 (antes de vender p/ SP/RJ em produção) |
| **Origem da mercadoria** (`orig`) — hardcoded 0 (nacional) no mapper. Produto importado/conteúdo importado exige orig 1-8 e alíquota interestadual de 4% | 🟠 (auditar se há revenda de item importado — pneus?) |
| cBenef (código de benefício fiscal PR) — só se houver benefício; reboque aparentemente não usa | 🟡 (confirmar contador) |
| Formas de pagamento reais na NF-e — mandamos `99` fixo; mapear PaymentMethod da OV (15=boleto, 17=PIX...) | 🟠 |

---

## 6. NOVOS TRIBUTOS (Reforma — IBS/CBS) ✅ núcleo pronto

**Estado atual:** o melhor cadastro do sistema. Schema + motor (CBS 0,9% / IBS UF 0,1%) + grupo UB + totais W03 + tabela oficial de **164 cClassTrib** + 22 TaxRules com os campos — **tudo validado pela SEFAZ em homologação** (rejeições 1026/1033 provaram a validação ativa).

| Gap | Prio |
|---|---|
| Grupo gRed (CSTs 200 — redução) — **#446**. Só bloqueia se alguma operação usar redução; GDR usa 000001 (integral) | 🟡 |
| `Product.cClassTrib` em massa — hoje o código vem da TaxRule (000001), o campo do produto é override. Preencher junto com NCM (#449) | 🟡 |
| Split payment — **#418**, não exigido em 2026 | 🟡 |
| Crédito IBS/CBS nas compras (apuração) — 2026 é informativo, sem apuração; preparar para 2027 junto com regime do fornecedor (item 2) | 🟡 |

---

## 7. M.P. / INSUMOS (cadastro de Produto)

**Estado atual:** bom para produção (BOM versionado, roteiro, custo médio, lote/validade, MRP). Fiscal fraco.

| Gap | Prio |
|---|---|
| NCM (295 itens — ver item 4) | 🟠 |
| **EAN/GTIN** — SEFAZ valida GTIN contra o Cadastro Centralizado; sem código de barras usar "SEM GTIN" (hoje o mapper nem envia o campo — verificar se Focus preenche default) | 🟠 |
| Origem da mercadoria por produto (0-8) | 🟠 |
| Peso bruto/líquido por produto — frete, volumes da NF-e e o grupo transportador | 🟡 |
| Unidade tributável ≠ comercial (conversão) | 🟡 |
| `tracksSerial: false` nos 17 reboques — deveria rastrear chassi (liga com BIN/ATPV-e #362/#363) | 🟠 |

---

## 8. FATURAMENTO — "o que falta?"

**Estado atual:** pipeline validado ponta a ponta (emissão, DIFAL, IBS/CBS, veículo, cancelamento, CC-e, devolução — 18 XMLs de referência em `docs/faturamento/xmls-homologacao/`).

Checklist do go-live:
- [ ] 🔴 Token de produção no Railway + `FOCUS_NFE_URL` produção (env por ambiente)
- [ ] 🔴 Webhook do painel Focus apontando para o Railway (autorização assíncrona + eventos)
- [ ] 🔴 Rotação de tokens (chamado aberto no suporte Focus — aguardando)
- [ ] 🔴 FCP SP/RJ (#445) — se houver venda interestadual consumidor final no dia 1
- [ ] 🟠 Grupo transportador + volumes (qVol/esp/pesos) — hoje `modalidade_frete 9` fixo; decisão da auditoria foi transportadora terceira
- [ ] 🟠 Formas de pagamento reais (item 5)
- [ ] 🟠 Numeração de produção: painel está série 1 / próximo nº 1 — confirmar com contador se deve continuar a numeração do Wenext (inutilização de faixa se necessário — módulo FiscalVoidRange existe)
- [ ] 🟠 Primeira venda B2B real valida IE (rejeição 234 não é testável em homologação)
- [ ] 🟡 Contingência SEFAZ (SVC-RS) — ERPs de mercado têm; Focus suporta, nós nunca testamos

---

## 9. NF-e / XML

**Estado atual:** XML completo persistido no `FiscalDocument` via webhook + número/série/protocolo (#361). XMLs de homologação versionados no repo.

| Gap | Prio |
|---|---|
| **Exportação mensal de XMLs para o contador** (ZIP por período — todo ERP de mercado tem; obrigação de guarda de 5 anos) | 🟠 |
| Persistir `caminho_danfe` para reimpressão de DANFE | 🟡 |
| Download de XML/DANFE na tela do documento fiscal (frontend) | 🟡 |

---

## Itens do quadro fora do sistema (decisão de negócio)
- **"Quem emite nota?"** (S/N por pessoa) — definir operadores e roles no Avequi (role FINANCIAL já limita emissão)
- **"Cliente — particularidades (Alan)"** — mapear com o Alan os casos especiais e validar se os campos do #474 cobrem

## Resumo executivo
O **núcleo da reforma está pronto e validado** — nenhum cadastro novo de IBS/CBS bloqueia 03/08. Os bloqueadores reais do go-live são **operacionais** (tokens/webhook/numeração de produção) e **2 fiscais** (FCP p/ SP-RJ e indicador de contribuinte no cliente). O cadastro mais defasado é o **Fornecedor** (impacta o crédito de IBS/CBS a partir de 2027). NCM de estoque e melhorias de produto são pós-go-live.
