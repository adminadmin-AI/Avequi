# Bootstrap Avequi — sugestões a partir do `Mapeamento_Nota_Item` (Fase 2, PR-3 · #609)

> **Para quem chega agora:** antes do ERP, a Avequi mantinha no producao_v2
> (DB_Financeiro, SQL Server) uma tabela `Mapeamento_Nota_Item` que dizia,
> **por descrição da nota**, se um item comprado era uma Peça/Matéria-prima
> do catálogo, um insumo ou um EPI. Este passo transforma esse conhecimento
> em **sugestões** no `SupplierProductMap` — nunca em confirmações. É
> ferramenta de migração da Avequi, descartável; o ERP não depende dela.

## Dependência de branch

Empilhado sobre a #1131 (`compras/609-supplier-product-map-servico`, HEAD
`cf2b20c`): usa `SupplierProductMapService.suggest`, `aggregatePairs` e
`normalizeSupplierProductCode`. **Base do PR = branch da #1131.** Quando a
#1131 for mergeada na `main`, trocar a base deste PR para `main` (rebase
trivial — nenhum arquivo em comum é alterado).

## O que é o legado (auditoria read-only de 25/08)

- 747 linhas · identidade antiga = `DescricaoNota` (texto), **sem fornecedor,
  sem company** — exatamente o que a identidade canônica rejeita.
- Alvo: `PecaId → Pecas.Codigo` / `MateriaPrimaId → Materia_Prima.Codigo`,
  que coincidem com `Product.sku` da GDR. Tipos: Comprado 101, MP 53
  (→ Product), Insumo 518, EPI 75 (→ só "parece CONSUMABLE").
- 4 descrições duplicadas idênticas (mesmo alvo), 0 conflitos internos.

## Fluxo

```
Mapeamento_Nota_Item ──export TSV (Id, DescricaoNota, Ocorrencias, TipoMapeamento, Codigo)──┐
                                                                                            ▼
FiscalDocument RECEBIDA AUTHORIZED → pares (companyId, supplierId, cProd) + TODAS as descrições vistas
                                                                                            │
                                     descrição normalizada = chave de BUSCA (nunca identidade)
                                                                                            ▼
        Comprado/MP → Codigo → Product.sku do MESMO tenant, ativo, único ⇒ WOULD_SUGGEST_PRODUCT
        Insumo/EPI                                                    ⇒ WOULD_SUGGEST_KIND (CONSUMABLE)
        resto ⇒ SKIPPED_TENANT / SKIPPED_INACTIVE_PRODUCT / AMBIGUOUS / INVALID / NO_MATCH
                                                                                            ▼
        precedência: decisão humana (CONFIRMED/REVIEW) > sugestão existente > seed > nada
                                                                                            ▼
        --commit (gate) → SupplierProductMapService.suggest(source = SEED_PRODUCAO_V2) → SUGGESTED + evento
```

`SUGGESTED ≠ RESOLVED/CONFIRMED`: nenhum par sai da fila de decisão humana
por receber sugestão; `kind`/`productId` canônicos continuam `NULL`
(CHECK `spm_pre_canonical_clean`); confirmar é outro ato, auditado.

## Schema: `suggestedKind` é semanticamente correto?

Sim. `SupplierProductMap` tem `suggestedKind`/`suggestedProductId`/
`suggestionSource` separados de `kind`/`productId` canônicos, e os CHECKs da
#1126 exigem canônico vazio em `UNRESOLVED`/`SUGGESTED`. Insumo/EPI viram
`suggestedKind = CONSUMABLE` sem tocar o canônico.

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/modules/purchase/seed-producao-v2.core.ts` | núcleo puro: parser do TSV, índices, `planSeed` (outcomes + precedência), `summarizeSeed` (suggestionCoverage × confirmedCoverage), `nominalEvidence` |
| `scripts/seed-supplier-product-map-producao-v2.ts` | script: lê o TSV, monta pares por tenant, planeja, grava relatório + artefato para a UI; `--commit` só com evidência do mesmo dia |
| `seed-producao-v2.core.spec.ts` | 12 testes (abaixo) |

## Regras de segurança

- **Dry-run é o default.** `--commit` exige `.seed-producao-v2-dryrun.json` do
  **mesmo dia** com o conjunto nominal (`companyId|supplierId|cProd|alvo`)
  **idêntico**; qualquer diferença aborta antes de escrever.
- Escrita só via `SupplierProductMapService.suggest` (transação + evento;
  teto `SUGGESTED` por `maxStatusForSource`).
- Nunca: `CONFIRMED`; kind/productId canônico; UPDATE de decisão humana;
  sobrescrever sugestão diferente (⇒ `CONFLICT_EXISTING_SUGGESTION`); criar
  Product/Supplier; tocar `FiscalDocumentItem`; match cross-tenant (código
  que só existe em outra company ⇒ `SKIPPED_TENANT`).
- Idempotente: mesma sugestão já registrada ⇒ `UNCHANGED`.
- Tabela de mapas ausente (migration pendente) ⇒ dry-run avisa e
  `--commit` é impossível.

## Exclusões nominais do legado (versionadas no script)

A fonte legada nunca é editada. Quando uma linha do `Mapeamento_Nota_Item`
não deve virar sugestão (decisão humana), ela entra em `LEGACY_EXCLUSIONS`
no script, com razão — e o planner devolve `SKIPPED_MANUAL_EXCLUSION` (não
`INVALID`: o dado existe, estamos recusando usá-lo conscientemente). A
exclusão entra na evidência nominal do gate do `--commit`.

| legacyId | Razão |
|---|---|
| 225 | ARRUELA 1/4 LISA não corresponde à Arruela do Francês 3/8; exclusão confirmada após auditoria física em 25/08/2026 (Rafael) — o par PROIND `07849` fica sem sugestão; os pares PROIND `08070` (ARRUELA 3/8 INOX LISA) continuam sugerindo `COM-CHA-004` |

## Dry-run read-only de 25/08 (dados reais; nada escrito)

| | GDR Reboques (1.177 pares) | CRD (970 pares) |
|---|---|---|
| WOULD_SUGGEST_PRODUCT | **123** — R$ 3.085.178,72 (121 + 2 pares PROIND `08070` → `COM-CHA-004`) | 0 |
| WOULD_SUGGEST_KIND | 512 — R$ 622.098,52 | 93 — R$ 292.188,39 |
| SKIPPED_TENANT | 0 | 62 — R$ 1.380.061,28 (Products da GDR) |
| SKIPPED_INACTIVE_PRODUCT | 0 (era 3 antes da reativação auditada de `COM-CHA-004` em 25/08) | 0 |
| SKIPPED_MANUAL_EXCLUSION | 1 — R$ 268,00 (PROIND `07849`, legado Id 225) | 0 |
| AMBIGUOUS | 2 (cProd genéricos `10`/`11`: chapa + insumo) | 2 (idem) |
| NO_MATCH | 539 — R$ 4.499.962,16 | 813 — R$ 7.018.256,43 |
| **suggestionCoverage** (componentes comprados de BOM ativa) | **36 / 57** | 0 / 0 |
| **confirmedCoverage** | **0 / 57** | 0 / 0 |

Total: 123 sugestões de Product + 605 de kind (R$ 4,0 mi) — **0 resolvidos**.
Os 21 componentes de BOM ativa **sem** sugestão (por nº de BOMs): COM-LAT-004,
COM-EIX-005, COM-CHA-002, COM-SUS-004, COM-CHA-005,
MP-CHP-003, MET-EIX-005, COM-PAR-002, COM-EIX-002, MP-CHP-006, MP-CHP-007,
MP-CHP-001, MP-CHP-002, MP-TUB-001, MP-TUB-003, MP-TUB-004, COM-EIX-006,
COM-EIX-007, COM-SUS-006, COM-EIX-008, COM-EIX-009.

Artefato para a primeira tela: `bom-priority-<companyId>.json` (por
componente: sku, nome, tipo, nº de BOMs, status COM/SEM sugestão, pares
fiscais com fornecedor, cProd, descrição, valor acumulado, nº de notas,
último preço, sugestão). Contém dados da empresa — fica fora do repositório
(gerado no diretório `--report`).

## Genérico × específico

- **Genérico (produto)**: `suggest()`, precedência humano > sugestão, tenant,
  `suggestedKind` — tudo já no serviço (#1131).
- **Específico Avequi (este PR)**: parser do TSV do SQL Server, casamento por
  `DescricaoNota`, `Codigo → sku`, Insumo/EPI → CONSUMABLE, script one-shot.
  Descartável após o bootstrap.

## Testes (`seed-producao-v2.core.spec.ts`)

Product ativo → sugestão; Insumo/EPI → kind; mesmo texto em fornecedores
diferentes (uma sugestão por par); tenant diferente (SKIPPED_TENANT; kind
vale em qualquer tenant); Product inativo; código inexistente; sem match;
ambiguidade (2 Products, Product + kind, duas descrições incompatíveis no
mesmo par); zeros à esquerda; decisão humana nunca rebaixada; mesma
sugestão ⇒ UNCHANGED e sugestão diferente ⇒ conflito; suggestionCoverage ≠
confirmedCoverage; evidência nominal; parser. O gate de `--commit` é
exercitado no script (evidência ausente / de outro dia / conjunto diferente
⇒ abort sem escrita).

## Decisões pendentes (Rafael)

1. ~~`COM-CHA-004` inativo~~ — reativado em 25/08 após auditoria (AuditLog
   `REACTIVATE_AFTER_AUDIT`); o par `07849` ficou fora por exclusão nominal.
2. ~~Aceitar as 605 sugestões de kind~~ — aprovadas (25/08) exatamente como
   desenhadas: só `suggestedKind`, nunca canônico.
3. Quando aplicar: após merge da #1131 e da migration `20260824230000` em
   produção — dry-run do dia + `--commit`, com relatório nominal.
