# Reidratação do histórico fiscal (11.081 notas legadas)

**O que é:** a carga de 18/06 importou o histórico fiscal para o ERP com três
defeitos estruturais, todos comprovados no pré-check de 21/08 e na
microauditoria de 24/08: (1) **empresas trocadas** em 100% dos documentos
(CRD→"GDR Reboques", GDR Reboques→"Guarapuava"); (2) **1.268 notas de
ENTRADA** misturadas como se fossem emissões; (3) **11.081 documentos sem
número/chave/datas/totais** (`authorizedAt` = data da importação). Este
importador reconstrói os 11.081 documentos em cima da estrutura canônica da
Fase 1 (#1122), usando o `legacyId` dos itens como fio de volta à origem.

O DB_Financeiro e os XMLs são **fonte de reconstrução, não nova fonte de
verdade permanente**: o resultado é o próprio `FiscalDocument` /
`FiscalDocumentItem` / `FiscalDocumentItemTax` — nenhuma tabela paralela.

## Arquitetura (2 etapas)

```
[SQL Server DB_Financeiro] ──┐
                             ├─► rehydrate-extract-source.py ──► headers.jsonl
[XMLs históricos em disco] ──┘        (somente leitura)          items.jsonl
                                                                 manifest.json
                                                                      │
[ERP Postgres] ◄── rehydrate-fiscal-history.ts ◄──────────────────────┘
                   dry-run por PADRÃO; --commit explícito e guardado
```

- **`apps/api/scripts/rehydrate-extract-source.py`** — roda na máquina que
  enxerga o SQL Server local e a pasta de XMLs; só faz SELECT e leitura de
  arquivos; emite um dataset determinístico com hashes.
- **`apps/api/scripts/rehydrate-fiscal-history.ts`** — CLI contra o banco do
  ERP. Sem `--commit` **não executa nenhuma escrita** (só SELECT + relatório
  do que *seria* alterado). Núcleo de decisão é puro e testado em
  `apps/api/src/fiscal/rehydration/rehydration-core.ts`.

## Regras de negócio

### Company e direção — SEMPRE derivadas do documento (nunca mapa fixo)

| Proveniência do item | direction | companyId | issuerCnpj | recipientCnpj |
|---|---|---|---|---|
| `item_saida_*` | EMITIDA | CNPJ do **emitente** | emitente | destinatário |
| `item_entrada_*` | RECEBIDA | CNPJ do **destinatário** | fornecedor | a própria company |

CNPJ que não resolve para exatamente 1 Company: 0 → `SKIPPED_UNRESOLVED`;
2+ → `CONFLICT`. Nunca adivinhar.

### Datas (decisão N2)

- **Com XML confiável**: `issueDate ← ide/dhEmi`, `authorizedAt ←
  protNFe/infProt/dhRecbto`, `protocolNumber ← nProt` — offset/fuso
  preservado byte a byte (há `dhRecbto` em −05:00 no histórico).
- **Sem XML confiável** (1.725 saídas): número/série/chave/natureza/tpNF/
  totais/protocolo vêm do DB_Financeiro (não têm componente de fuso);
  `issueDate ← data_emissao` interpretada como America/Sao_Paulo (−03:00);
  **`authorizedAt = NULL` + pendência `AUTH_TIME_UNVERIFIED`**.
- **NUNCA** usar emissão como horário de autorização.
- *XML confiável* = ≥1 arquivo com chave interna conferindo e
  `protNFe/infProt` completo; com múltiplos arquivos, todos têm de concordar
  nos 3 fatos extraídos (dhEmi, dhRecbto, nProt).

### Suppliers

RECEBIDA com exatamente 1 Supplier de mesmo CNPJ **na company correta** →
`supplierId`; nenhum → NULL + `SUPPLIER_MISSING` (74 CNPJs, tratados na
frente de conciliação de compras); 2+ → `CONFLICT`. **Este importador nunca
cria Supplier.**

### 9 pares intra-grupo (decisão N1 — SAFE_AUTOMATIC)

9 NF-e de venda CRD→GDR Reboques existem, corretamente, como **2 documentos**
(EMITIDA na CRD + RECEBIDA na GDR). A carga anexou os 2 itens (o real + o
espelho do outro lado) a **cada** um dos 18 documentos. O importador:

- mantém os 18 documentos;
- em cada um, mantém só o item da sua perspectiva (EMITIDA → `item_saida_*`;
  RECEBIDA → `item_entrada_*`) e marca o espelho como `WOULD_DELETE_MIRROR`;
- o DELETE futuro é **apontado por id** da allowlist congelada
  (`src/fiscal/rehydration/allowlist-intra-group.json`, gerada da evidência
  da microauditoria de 24/08) — **nunca** `DELETE WHERE legacyId LIKE ...`;
- antes de considerar a remoção, revalida TODOS os invariantes auditados
  (par existe, chave coincide, direção esperada, espelho continua exato
  campo a campo, 1 tax por item via CASCADE, nada concorrente mudou);
  qualquer falha → `CONFLICT`;
- no `--commit`, os 2 documentos de um par rodam **na mesma transação**.

### unitPrice (decisão N4) e impostos

`unitPrice` **nunca é alterado**. A origem traz até 10 casas decimais
(vUnCom); a coluna do ERP é `Decimal(14,4)` e a carga arredondou half-up —
divergência só de representação não é divergência (as 336 diferenças do
histórico são todas de representação; divergências reais: **0**).
Impostos: só *backfill* de `origemIcms`/`modalidadeBcIcms` quando o campo
está NULL — valor existente nunca é sobrescrito.

### Focus (decisão N3 adiada)

Os 6 documentos com `focusRef` (identificação determinística) ficam fora por
regra. A anomalia da chave com prefixo "NFe" NÃO é corrigida aqui.

## Estados

`UNCHANGED` · `WOULD_UPDATE` · `WOULD_DELETE_MIRROR` · `UPDATED` ·
`DELETED_MIRROR` · `SKIPPED_UNRESOLVED` · `CONFLICT` · `FAILED` ·
`FOCUS_IGNORED` — mais as pendências `AUTH_TIME_UNVERIFIED`,
`SUPPLIER_MISSING`, `XML_MISSING`, `UNITPRICE_DIVERGENT`,
`INTRA_GROUP_PAIR`. São resultado operacional do relatório (JSON), sem
tabela de status: a idempotência vem da comparação campo a campo — depois de
reidratado, reexecutar devolve `UNCHANGED` sem novo UPDATE/DELETE.

## Segurança do `--commit` (não executado nesta rodada)

1. Exige a migration `20260821120000` no banco (senão **aborta**; o dry-run
   roda em modo `PRE_MIGRATION` só para relatório).
2. Exige evidência de dry-run **do mesmo dia** no diretório de relatório.
3. **Aborta antes de qualquer escrita** se o universo divergir do auditado
   (11.087 docs / 11.081 históricos / 6 Focus / 14.108 itens / 18 espelhos /
   9.828 EMITIDA / 1.259 RECEBIDA / 14.090 itens finais) ou se a simulação
   apontar colisão nas uniques `(companyId, chave)` /
   `(companyId, issuerCnpj, series, number, type)`.
4. Transação por documento (pares: por par). Falha → rollback daquele
   documento/par, contabilizado como `FAILED`, e o resto continua.

## Como rodar

```bash
# 1) extração (máquina com SQL Server + XMLs) — somente leitura
python apps/api/scripts/rehydrate-extract-source.py --out /tmp/rehydration-source

# 2) dry-run (padrão) — nenhuma escrita
DATABASE_URL=... npx ts-node -T apps/api/scripts/rehydrate-fiscal-history.ts \
  --source /tmp/rehydration-source --report /tmp/rehydration-report

# 3) commit real — SÓ com migration em produção e autorização expressa
#    (dry-run do mesmo dia é pré-requisito verificado pelo programa)
DATABASE_URL=... npx ts-node -T apps/api/scripts/rehydrate-fiscal-history.ts \
  --source /tmp/rehydration-source --report /tmp/rehydration-report --commit
```

## Dry-run real de 24/08/2026 (produção, somente leitura)

11.087 analisados → **11.081 WOULD_UPDATE**, 6 FOCUS_IGNORED, **0 conflitos,
0 unresolved**; 18 WOULD_DELETE_MIRROR; assertions 100%; **0 colisões**
simuladas nas duas uniques. Pendências: 1.725 AUTH_TIME_UNVERIFIED (=
XML_MISSING), 773 SUPPLIER_MISSING (764 do pré-check + os 9 pares RECEBIDA —
a CRD não é fornecedor cadastrado da GDR), 0 unitPrice reais (336 de
representação). Estado final projetado: 9.828 EMITIDA + 1.259 RECEBIDA =
11.087; itens 14.108 → 14.090.
