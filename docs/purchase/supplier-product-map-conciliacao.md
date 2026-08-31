# Conciliação de compras — SupplierProductMap (Fase 2, PR-2 · #609)

> **Para quem chega agora:** cada NF-e de compra traz, por item, o código que
> o **fornecedor** usa (`cProd`) e uma descrição livre. O ERP precisa saber
> que "fornecedor X + código Y" é o **nosso** produto Z — uma vez — e usar
> isso para o histórico inteiro e para as próximas compras. Esse de-para é o
> `SupplierProductMap` (fundação no PR-1, #1126). Este passo entrega o
> **serviço** que lista os pares com contexto para decidir, prioriza o que
> importa (BOM ativa → valor → recorrência) e registra cada decisão humana
> com auditoria. A UI V1 (fila de trabalho) está descrita no fim; não há motor de custo.

```
FiscalDocument RECEBIDA (AUTHORIZED, com supplierId)
   └─ FiscalDocumentItem.cProd ─┐
                                ├─ par (companyId, supplierId, cProd)  ← identidade canônica
   Supplier ────────────────────┘        │
                                         ├─ SupplierProductMap (status/kind/productId + suggested*)
                                         │      └─ SupplierProductMapEvent (trilha: quem, quando, de→para, razão)
                                         └─ Product (canônico) ── BomItem (BOM ativa) → "impacta custo?"
```

## Arquitetura (`apps/api/src/modules/purchase/`)

| Arquivo | Papel |
|---|---|
| `supplier-product-map.rules.ts` (PR-1) | regras puras: invariantes por status, transições, teto por origem da sugestão, tenant, divergência de descrição |
| `supplier-product-map.aggregate.ts` | **núcleo puro** da listagem: `normalizeSupplierProductCode`, `aggregatePairs`, `buildPairViews`, `comparePriority`, `summarize`, `bomCoverage`, `suggestByDescription` |
| `supplier-product-map.service.ts` | I/O Prisma + transações: listagem derivada, detalhe, `confirmProduct`, `classify`, `suggest`, `dismissSuggestion`, `flagReview`, `detectDivergences`, sugestões por descrição |
| `supplier-product-map.controller.ts` | `GET/POST /purchase/supplier-product-maps/…` |
| `dto/supplier-product-map.dto.ts` | validação dos corpos/queries |

## Como a listagem é agregada

1. Carrega os `FiscalDocumentItem` dos documentos `RECEBIDA` da company com
   `supplierId` (5 mil linhas hoje; leve o bastante para agregar em memória).
2. `aggregatePairs` agrupa por `(supplierId, trim(cProd))` contando **só
   documentos `AUTHORIZED`** — cancelados/rejeitados não contaminam valor,
   recorrência nem "última compra". Métricas: documentos distintos, linhas,
   quantidade, valor acumulado, última compra, último preço unitário,
   descrição/NCM/unidade **mais recentes** (evidência, não identidade) e
   quantas descrições distintas o fornecedor já usou para o mesmo código.
3. Cruza com as linhas de `SupplierProductMap` existentes (pares sem linha
   aparecem como `UNRESOLVED`; **listar não escreve nada**). Um mapa sem item
   autorizado também aparece (métricas zeradas).
4. Anexa fornecedor, Product canônico, Product sugerido e a relevância para
   BOM ativa; ordena por `comparePriority`; pagina em memória.

> Escala: quando o volume crescer (centenas de milhares de itens), o passo 1–2
> vira uma view materializada/`GROUP BY` no banco sem mudar o contrato — o
> núcleo puro continua sendo a especificação testada.

## Identidade canônica

`(companyId, supplierId, supplierProductCode)` — `supplierProductCode` é o
`cProd` **exato** (só `trim`; zeros à esquerda, caixa e espaços internos
preservados: `0012 ≠ 12`). Descrição não identifica; NCM não identifica; o
mesmo CNPJ em duas companies são dois fornecedores e dois mapas; não existe
matching global entre empresas.

## Prioridade: BOM ativa → valor → recorrência

`priorityTier`: **0** = pendente ligado a componente de BOM ativa (pelo
canônico ou pela sugestão) · **1** = pendente · **2** = resolvido. Dentro do
tier: valor acumulado desc, depois nº de documentos desc, depois código.
Por que tiers em vez do score logarítmico do PR-1: com `log(valor)` um CAPEX
de R$ 1 mi passa na frente de um componente de BOM de R$ 5 mil, e a meta
declarada é fechar a BOM ativa **primeiro** e só depois os ~80 % do valor.
`provisionalPriorityScore` (PR-1) fica como referência histórica.

**"O que impede calcular o custo das BOMs ativas?"** →
`GET /bom-coverage`: para cada componente de alguma `BomVersion.isActive`
**com evidência de sourcing externo**, quantos pares `CONFIRMED` apontam
para ele e quantos só sugerem. `covered=false` = nenhum par confirmado =
custo de aquisição não fecha. Sugestão **não** cobre.

Critério canônico de "componente comprado" (`purchasedReason`, cada linha
diz por que entrou; o schema não tem flag make/buy no Product):

| Motivo | Regra |
|---|---|
| `BY_TYPE` | `RAW_MATERIAL`, `COMPONENT`, `CONSUMABLE` — comprados por natureza |
| `PURCHASE_EVIDENCE` | já comprado: `POItem`, `SupplierPriceHistory` ou mapa `CONFIRMED` apontando para ele — vale para qualquer tipo, inclusive `SEMI_FINISHED` e `FINISHED_GOOD` |
| `LEAF_SEMI_FINISHED` | `SEMI_FINISHED` sem `BomVersion` própria ativa — não é fabricado aqui, logo vem de fora |

`SEMI_FINISHED` com BOM própria e sem evidência de compra fica **fora** (o
custo dele vem da própria BOM). `FINISHED_GOOD` **nunca** entra por
inferência — só com evidência. Estado 25/08 (GDR): os 243 `SEMI_FINISHED`
que aparecem como componente têm BOM própria ativa e não há PO/preço
registrado → o universo continua **57** componentes (16 `RAW_MATERIAL` +
41 `COMPONENT`); a regra é para o futuro (semiacabado comprado de terceiro)
sem inflar o presente.

## Sugestão ≠ verdade

- Verdade canônica = `kind` + `productId`, só em `CONFIRMED`/`REVIEW`
  (`REVIEW` mantém o vínculo anterior). Antes disso ficam `NULL` — CHECKs
  do banco (PR-1) + `validateState` garantem.
- Sugestão = `suggestedProductId`/`suggestedKind`/`suggestionSource`
  (`SEED_PRODUCAO_V2 | DESCRIPTION | RULE_NCM | MANUAL`). `suggest()` leva
  o par no máximo a `SUGGESTED`, **mesmo com ator humano**
  (`maxStatusForSource`); confirmar é sempre outro ato.
- Racional/confiança da sugestão vai no `SupplierProductMapEvent.reason`
  (ex.: `DESCRIPTION jaccard=0.67 tokens=[PARAFUSO M8 30] segundo=COM-002(0.40)`).
- **Sugestão por descrição** (`POST /suggestions/description`): Jaccard de
  tokens tolerante a abreviação (prefixo ≥ 4: `SEXT`~`SEXTAVADO`) entre a
  descrição mais recente e o **nome** dos Products ativos do tenant. Só vira
  sugestão quando é clara (score ≥ 0,5 e folga ≥ 0,15 sobre o 2º); ambiguidade
  não sugere. Sem NCM, sem IA. `apply=false` (default) só mostra a prévia.
- Seed `Mapeamento_Nota_Item` do producao_v2: entra por `suggest(source =
  SEED_PRODUCAO_V2)` num script de importação próprio (fora deste PR) —
  também só `SUGGESTED`.

## Resolução (ato humano, transacional, auditado)

| Operação | Transição | Evento |
|---|---|---|
| `confirmProduct(productId)` | `UNRESOLVED/SUGGESTED/REVIEW → CONFIRMED` (kind `PRODUCT`) | `CONFIRMED`; se já era `CONFIRMED`/`REVIEW` → `RECLASSIFIED` com `fromProductId → toProductId` |
| `classify(CONSUMABLE\|ASSET\|FREIGHT_OTHER)` | idem, `productId = NULL` | `CONFIRMED` / `RECLASSIFIED` (`fromKind → toKind`) |
| `suggest({productId\|kind, source})` | `→ SUGGESTED` (nunca `CONFIRMED`) | `SUGGESTED` (razão = origem + racional) |
| `dismissSuggestion` | `SUGGESTED → UNRESOLVED` (limpa `suggested*`) | `REVERTED` (a sugestão descartada fica na razão) |
| `flagReview(reason)` | `CONFIRMED → REVIEW` (mantém canônico) | `REVIEW_FLAGGED` |

A linha de mapa nasce na **primeira** decisão/sugestão (`ensureMap`, com
`lastSeen*` da última compra) — sem backfill. `confirmedDescription` guarda a
descrição no momento da confirmação; `detectDivergences` compara com a mais
recente e lista candidatos a `REVIEW` (não altera nada sozinho).
Tudo dentro de `$transaction`: UPDATE do mapa + INSERT do evento. Nada é
apagado; trocar Product ou classificação preserva a história.

Tenant: `ensureMap` só encontra `Supplier` com o `companyId` do usuário;
`assertProductInTenant` + `validateTenantConsistency` rejeitam Product de
outra company — nada gravado em caso de erro.

## Histórico: por que NÃO reescrever `FiscalDocumentItem.productId`

O mapa é o de-para canônico e vale para o histórico por **junção**
(`item.cProd` + `documento.supplierId` → mapa → Product). Materializar
`productId` em milhares de itens a cada confirmação/troca criaria redundância
que pode divergir do mapa (troca de Product exigiria varrer tudo de novo).
Se o motor de custo/performance precisar da coluna no item, isso é uma
**projeção reexecutável** em passo próprio (job idempotente que recalcula
`productId` a partir do mapa, com auditoria), fora deste PR — e nunca
backfill manual em produção.

## Company sem catálogo (caso CRD)

O desenho aceita uma company ficar **parcialmente `UNRESOLVED` por tempo
indeterminado** sem inconsistência: a listagem é derivada (pares sem mapa
são `UNRESOLVED` sem linha), `summary`/`bom-coverage` só contam o que
existe, nada é classificado automaticamente. Política: o que é claramente
`CONSUMABLE`/`ASSET`/`FREIGHT_OTHER` pode ser classificado à mão; potencial
produto sem Product cadastrado **permanece `UNRESOLVED`** (nunca "não-produto"
por falta de catálogo). Primeiro objetivo de custo/BOM = GDR Reboques.

## Limites assumidos e caminho de escala (waivers do list-query-lint, PERF #1028)

| Leitura | Volume hoje (por tenant) | Por que completa | Escala (sem mudar o contrato) |
|---|---|---|---|
| `FiscalDocumentItem` das `RECEBIDA` com fornecedor (colunas mínimas) | CRD 2,8 mil · GDR 2,4 mil (+1–2 mil/mês) | agregação por par em memória; é a base da listagem inteira | `GROUP BY (companyId, supplierId, trim(productCode))` + `DISTINCT ON` no banco quando passar de ~100 mil itens/tenant |
| `SupplierProductMap` da company (waiver) | 0 hoje; ≤ nº de pares (~2,1 mil); cresce só com cProd novo | a listagem precisa cruzar **todos** os pares com **todos** os mapas para ordenar por prioridade; paginar aqui quebraria a ordenação; índice `(companyId,status)`/`(supplierId)`; parcial com filtro de fornecedor | mesma agregação no banco |
| `Product` ativo da company (waiver) | ~350 (catálogo de cadastro) | só na sugestão por descrição, que compara contra o catálogo inteiro; com `ids` é limitado ao conjunto | busca textual (tsvector/trigram) quando o catálogo passar de dezenas de milhares |
| `SupplierProductMap` `CONFIRMED` (waiver) | subconjunto pequeno, sob demanda | detecção de divergência de descrição | idem |

Leituras auxiliares de BOM/evidência (`bomVersion.groupBy`, `pOItem.groupBy`,
`supplierPriceHistory.groupBy`) são limitadas aos ids dos componentes —
sem waiver.

## Endpoints (`/purchase/supplier-product-maps`)

| Método/rota | Permissão | O quê |
|---|---|---|
| `GET /` | `purchases.supplier-map.view` | listagem priorizada (`status`, `supplierId`, `q`, `bomOnly`, `pendingOnly`, `page`, `pageSize`) |
| `GET /summary` | view | pares por status, valor total/resolvido/%, quantos pares faltam para ~80 %, pendentes ligados a BOM |
| `GET /bom-coverage` | view | componentes comprados das BOMs ativas × cobertura |
| `GET /pairs/:supplierId/:code` | view | detalhe + eventos (`code` URL-encoded) |
| `GET /divergences` | view | confirmados cuja descrição atual diverge |
| `POST /pairs/:supplierId/:code/confirm-product` | `purchases.supplier-map.resolve` | `{ productId, reason? }` |
| `POST /pairs/:supplierId/:code/classify` | resolve | `{ kind: CONSUMABLE\|ASSET\|FREIGHT_OTHER, reason? }` |
| `POST /pairs/:supplierId/:code/suggest` | resolve | `{ productId? , kind?, rationale? }` (source `MANUAL`, fica `SUGGESTED`) |
| `POST /pairs/:supplierId/:code/dismiss-suggestion` | resolve | `{ reason? }` |
| `POST /pairs/:supplierId/:code/review` | resolve | `{ reason }` |
| `POST /suggestions/description` | resolve | `{ apply?: boolean }` — prévia ou grava `SUGGESTED` |

Permissões novas no catálogo (seed por `code`) — **matriz V1 aprovada
(Rafael, 25/08)**: `view` → COMPRADOR, FISCAL, GERENTE_FINANCEIRO, FINANCEIRO
(+ DIRETOR/admins pelo padrão existente); `resolve` → COMPRADOR, FISCAL,
GERENTE_FINANCEIRO (+ admins pelo padrão). Não ampliar.

Fora deste PR (decididos): seed `Mapeamento_Nota_Item` → só `SUGGESTED`
(`source=SEED_PRODUCAO_V2`, dry-run antes de apply, só Product existente do
tenant, descrição/NCM nunca identidade) em PR/script próprio; materialização
de `FiscalDocumentItem.productId` fica para o motor de custo (projeção
controlada a partir de mapas `CONFIRMED`).

## UI V1 — fila de trabalho (`apps/web/src/app/app/purchases/conciliation/`)

> Primeira tela utilizável desta frente. Não é um módulo administrativo: é uma
> **fila** para fechar, um item por vez, primeiro o que trava o custo das BOMs
> ativas e depois os pares de maior valor. Menu **Suprimentos → Conciliação de
> compras** (`/app/purchases/conciliation`, gate `purchases.supplier-map.view`).

| Arquivo | Papel |
|---|---|
| `conciliation.ts` | lógica pura testada: tipos do contrato, rótulos pt-BR, `buildListParams` (nunca manda `companyId`; `bomOnly`/`pendingOnly` só quando true), presets, `effectiveBomOnly`, métricas do resumo (só as da API), `decisionRequest`/`describeDecision` |
| `page.tsx` | resumo compacto (`/summary` + `/bom-coverage`), filtros, tabela server-mode (`GET /`), diálogo e drawer |
| `resolve-dialog.tsx` | decisão humana: **Confirmar sugestão** · **Escolher Product** (busca `GET /products/options?isActive=true`, paginada, tenant pelo JWT) · **Não é produto** (Consumo / insumo · Ativo / imobilizado · Frete / outro → `CONSUMABLE`/`ASSET`/`FREIGHT_OTHER`) — com o bloco "O que será gravado" antes do botão |
| `pair-detail-sheet.tsx` | drawer de auditoria: métricas, decisão, sugestão + origem, eventos (`GET /pairs/:supplierId/:code`), ações secundárias (descartar sugestão, marcar para revisão) |

Comportamento que a UI garante (além do backend):

- **Um par por vez.** Não existe seleção múltipla nem confirmação em lote;
  cada `confirm-product`/`classify` é um clique explícito com a frase exata
  do que será gravado à vista.
- **Sugestão é contexto.** Aparece como "Sugestão: SKU · nome" com a origem
  discreta (`SEED_PRODUCAO_V2` = "importada da ferramenta de produção
  (legado)"); confirmar é sempre outro ato. A tela funciona igual sem
  sugestão nenhuma (par `UNRESOLVED` → Escolher Product / Não é produto).
- **BOM primeiro.** Visão inicial = *Pendentes* + "Só o que bloqueia custo de
  BOM" ligado quando `/bom-coverage` devolve componentes (company sem BOM
  começa com a fila completa). Linha de `priorityTier 0` ganha o selo
  **Bloqueia BOM** e o texto "Usado em N BOMs ativas". O resumo mostra
  "componentes de BOM cobertos X/Y" direto de `covered`.
- **Sem recálculo no front.** Pendentes = `UNRESOLVED+SUGGESTED+REVIEW` de
  `/summary`; valor sem decisão = `totalValue − resolvedValue`; cobertura =
  contagem de `covered`. Ordem da fila é a do backend (sem `sort`).
- **Permissões.** `view` → consulta tudo, drawer inclusive, sem botão de
  ação; `resolve` → botões Confirmar/Resolver/Trocar, Descartar sugestão,
  Marcar para revisão. Só UX: o `PermissionGuard` continua a autoridade.
- **Mobile.** `DataTable` vira cards abaixo de `sm`; ações no rodapé do card;
  diálogo e drawer já são responsivos.

Fora da V1 (decididos): confirmação em lote, IA, seed pela UI, upload,
materialização de `FiscalDocumentItem.productId`, motor de custo,
precificação, Focus, NFS-e/CT-e, "sugerir manualmente" (`POST /suggest`) e
`/divergences` (ficam para uma V2 do drawer).

Testes: `conciliation.spec.ts` (vitest, lógica pura — a suíte web não tem
DOM): parâmetros da listagem sem `companyId`, presets, `bomOnly` só quando
true, visão inicial por BOM, resumo, destaque da linha, modo inicial do
diálogo, corpos exatos de `confirm-product`/`classify`, item sem sugestão
resolvível, sugestão ≠ confirmado, URL-encode do cProd, gate de ações por
permissão.

## Testes

`supplier-product-map.aggregate.spec.ts`: trim/zeros à esquerda, mesmo cProd
em fornecedores diferentes, cancelado/rejeitado fora das métricas, itens sem
fornecedor/cProd ignorados, agregação (documentos distintos, "último" por
emissão, variantes de descrição), canônico × sugestão, confirmado (tier 2, BOM
via CONFIRMED), REVIEW mantém canônico, mapa sem item, ordenação
(BOM-sugerido > CAPEX > recorrência > resolvido), `summarize` (80 %),
`bomCoverage` (sugestão não cobre), `suggestByDescription` (claro / ambíguo /
inativo / sem afinidade).
`supplier-product-map.service.spec.ts` (banco fake com unique + CHECKs):
listagem sem escrita, tenant isolation (leitura e escrita; mesmo CNPJ em
duas companies), filtros/paginação, confirmar, trocar (`RECLASSIFIED`),
classificar não-produto e reclassificar, sugestão nunca confirma, descartar,
review, ator obrigatório, zeros à esquerda na identidade, sugestão por
descrição (prévia não escreve; apply → `SUGGESTED`; reexecução idempotente),
divergência. `pr341d.access.spec.ts`: matriz de permissões do controller.
