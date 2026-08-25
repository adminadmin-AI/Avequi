# Importação canônica de NF-e RECEBIDA a partir do XML (#608, PR-0)

> **Para quem chega agora:** hoje a empresa baixa manualmente do Qive os XMLs
> das notas que os fornecedores emitem contra a CRD e a GDR. Esta ferramenta
> lê essas pastas e grava as notas no ERP — no mesmo lugar e no mesmo formato
> das 1.259 notas recebidas que já existem — sem inventar tabela nova. Depois,
> quando a Focus passar a entregar os XMLs sozinha (#608), ela vai usar
> exatamente as mesmas peças: quem muda é só a origem do arquivo.

## Objetivo de negócio

1. parar de abrir um novo buraco de NF-e fora do ERP (o histórico canônico
   parou em 12/06/2026);
2. absorver os XMLs recentes preservados pelo Qive;
3. deixar a fundação pronta para a Focus assumir (PRs Focus-A/B/C da #608);
4. só então voltar à conciliação Supplier+cProd → Product (#609 PR-2).

## Peças (uma fundação, duas origens)

```
[pasta local / Qive] ──┐
                       ├─► parseNfeDocument (nfe-xml/nfe-proc.parser.ts)
[Focus NF-e, depois] ──┘        │  DTO canônico: cabeçalho, partes, itens, impostos, protNFe, eventos
                                ▼
                     buildTargetFromNfe / planBatch (inbound/received-nfe-import-core.ts)
                                │  plano por chave: INSERT | UNCHANGED | UPDATE | CONFLICT | SKIPPED | INVALID
                                ▼
                     applyPlan (inbound/received-nfe-import-writer.ts)
                                │  1 documento = 1 transação (doc + itens + impostos)
                                ▼
          FiscalDocument (direction=RECEBIDA) · FiscalDocumentItem · FiscalDocumentItemTax
```

| Peça | Arquivo | O que faz |
|---|---|---|
| Árvore XML | `apps/api/src/fiscal/nfe-xml/xml-tree.ts` | Parser XML mínimo, sem dependência, com erro em arquivo truncado. Substitui a leitura por regex (que confunde `CNPJ`/`xNome`/`CST` repetidos em grupos diferentes). É um tokenizer escrito do zero (~150 linhas) — decisão consciente: o monorepo não tem lib XML direta (só `saxes` transitivo via `exceljs`, que não deve ser dependência de domínio), a NF-e não usa DTD/entidades externas (sem superfície XXE) e o parser foi provado em 12.533 XMLs reais. |
| Parser NF-e | `apps/api/src/fiscal/nfe-xml/nfe-proc.parser.ts` | `nfeProc`/`NFe` → DTO (ide, emit, dest, itens com ICMS/IPI/PIS/COFINS/DIFAL/IBS-CBS, totais, protNFe); `procEventoNFe` → DTO de evento. Decimais como string. |
| Núcleo (puro) | `apps/api/src/fiscal/inbound/received-nfe-import-core.ts` | Resolve company (= destinatário), Supplier (exato, na company, **nunca cria**), direção, datas, eventos; compara com o existente; produz o plano e a evidência nominal. |
| Escritor | `apps/api/src/fiscal/inbound/received-nfe-import-writer.ts` | `planFromXml(xml, ctx)` (entrada para a Focus) e `applyPlan(tx, plan, xml)` (única porta de escrita). |
| CLI | `apps/api/scripts/import-received-nfe-xml.ts` | Varre pastas, monta contexto do ERP (só SELECT), relatório, gate e commit. |

Reaproveitado de `rehydration-core.ts`: `normalizeCnpj`, `resolveCompanyByCnpj`,
`resolveSupplier`, `assertHasOffset`, `sameDecimal`, `roundDecimalString`,
`sameIdSet` e as políticas (company derivada do documento, datas com offset,
idempotência por comparação campo a campo, gate nominal dry-run ⇄ commit).

## Regras

- **Company = destinatário** (`<dest>/CNPJ`) — nunca mapa fixo. Destinatário
  que não é company do ERP ⇒ `SKIPPED`.
- **Só NF-e (mod 55), produção (tpAmb 1), autorizada (cStat 100/150)**; NFC-e
  e homologação ⇒ `SKIPPED`; sem `protNFe`/chave inconsistente ⇒ `INVALID`.
- **Identidade** = `(companyId, chave)` (unique do schema). A mesma chave em
  outra company do grupo é outro documento (par intra-grupo, pendência
  `INTRA_GROUP`, mesma política N1 da reidratação).
- **Supplier**: match exato por CNPJ dentro da company. Ausente ⇒ importa com
  `supplierId = NULL` + pendência `SUPPLIER_MISSING` listada nominalmente no
  relatório; **nunca cria Supplier** (o cadastro é o fluxo canônico da #611).
  Reexecutar depois do cadastro religa (`UPDATE` legítimo `supplierId`).
- **Datas**: `issueDate ← ide/dhEmi`, `authorizedAt ← protNFe/dhRecbto`,
  `protocolNumber ← nProt`, offsets preservados.
- **Itens**: `nItem`, `cProd → productCode`, `xProd → productName`, NCM, CEST,
  CFOP, `uCom → unit`, `qCom`, `vUnCom`, `vProd`.
- **Impostos** (só o que `FiscalDocumentItemTax` modela): ICMS (`orig`, `modBC`,
  CST **ou CSOSN** em `cstIcms` — mesma convenção do histórico —, `vBC`,
  `pICMS`, `vICMS`), IPI, PIS, COFINS (CST/base/alíquota/valor), DIFAL
  (`ICMSUFDest` → `difal*`), IBS/CBS (`IBSCBS` → `cClassTrib`, `cst*`, bases,
  alíquotas, valores). ST, FCP interno e demais grupos não têm coluna ⇒ ficam
  só no XML preservado.
- **XML integral** gravado em `FiscalDocument.xml` (bytes do arquivo).
- **Existente** (`UNCHANGED`/`UPDATE`/`CONFLICT`): itens e impostos existentes
  **nunca são reescritos**. Só três mudanças são legítimas: `supplierId`
  nulo → resolvido; `xml` ausente → preenchido; `AUTHORIZED → CANCELLED` por
  evento registrado. Qualquer divergência de fato fiscal (emitente,
  número/série, `vNF`, quantidade/cProd/preço por `nItem`) ⇒ `CONFLICT`,
  nunca "corrigido por cima".

## Eventos e cancelamentos (export do Qive)

| Arquivo | Tratamento |
|---|---|
| `Autorizadas/**/<chave>.xml` (nfeProc) | Nota autorizada → `AUTHORIZED`. |
| `Canceladas/**/<chave>.xml` (nfeProc) | É a mesma nota autorizada; o cancelamento vem do **evento** 110111. A pasta sozinha não cancela nada. |
| `Eventos/<chave>_110111.xml` (cancelamento) | Com `retEvento/cStat` 135/155 ⇒ `status = CANCELLED`, `cancelledAt ← dhEvento`, `cancellationJustification ← xJust`. Sem registro ⇒ pendência `CANCEL_EVENT_UNREGISTERED`, não cancela. |
| `Eventos/<chave>_110110.xml` (carta de correção) | **Não persistido**: `FiscalCorrection` não modela `dhEvento`/autor. Contado em `CCE_NOT_PERSISTED`; arquivo preservado. Decisão de produto pendente. |
| Eventos 210xxx (manifestação) | Não representados nesta etapa (`MANIFEST_EVENT_IGNORED`); ver PR Focus-B. |
| Evento sem a nota no lote | `orphanEvents` no relatório; nada é aplicado. |
| Mesma chave em `Autorizadas` e `Canceladas` | Aceito se idêntico em dhEmi/nProt/vNF; divergente ⇒ `CONFLICT`. |

## Segurança operacional

- **dry-run é o padrão** — sem `--commit` não há INSERT/UPDATE.
- `--commit` exige: evidência de dry-run do **mesmo dia**
  (`.import-received-nfe-dryrun.json`), **zero CONFLICT** no lote e o conjunto
  **nominal** (chaves a inserir + documentos/campos a atualizar) idêntico ao do
  dry-run. Mudou o universo ⇒ aborta antes de escrever.
- 1 documento = 1 transação (`create` aninhado de itens/impostos; timeout 60 s
  como no reidratador).
- Reexecução após commit ⇒ `UNCHANGED` para tudo (idempotência comprovável).

```bash
cd apps/api
# dry-run (padrão)
DATABASE_URL=... npx ts-node -T scripts/import-received-nfe-xml.ts \
  --dir ~/projetos_claude/projeto_sql_xml/dados/notas_xml/notas_entrada_crd \
  --dir ~/projetos_claude/projeto_sql_xml/dados/notas_xml/notas_entrada_gdr \
  --report /tmp/recebidas
# commit (só após revisão do relatório e autorização)
DATABASE_URL=... npx ts-node -T scripts/import-received-nfe-xml.ts --dir ... --report /tmp/recebidas --commit
```

## Dry-run real de 25/08/2026 (export do Qive de 25/08, sem escrita)

1.684 arquivos (1.611 nfeProc + 60 eventos + …) → 1.610 chaves · **1.259
UNCHANGED** (todas as notas já reidratadas batem campo a campo com o XML) ·
**351 INSERT** (CRD 170 · GDR 181; 1.064 itens, todos com imposto) · 0 UPDATE ·
**0 CONFLICT** · 0 INVALID · 0 SKIPPED · 0 arquivos inválidos · 0 eventos órfãos.

Composição dos 351 (chaves únicas; lista nominal em `inserts` no relatório):

| | 13/06 → 24/08/2026 ("buraco") | antes de 13/06 | total |
|---|---|---|---|
| `AUTHORIZED` | 310 | 0 | 310 |
| `CANCELLED` (evento 110111 registrado) | 13 | 28 | 41 |
| total | 323 | 28 | 351 |

As 28 antigas são todas notas canceladas: a carga de 18/06 (DB_Financeiro)
nunca registrou canceladas. Pendências: 27 docs (14 CNPJs, R$ 197,7 mil) sem
Supplier; 22 pares intra-grupo CRD→GDR; 32 CC-e não persistidas. Cobertura das
RECEBIDAS após o commit: contínua até **24/08/2026**.

Os números acima são do lote daquele dia — **nada é fixo no código**. Um novo
export do Qive na mesma pasta exige **novo dry-run** (a evidência nominal é do
dia e do conjunto exato; o `--commit` recomputa o universo e aborta se qualquer
chave a inserir/atualizar for diferente da evidência).

### Prova do parser no dataset real (25/08/2026, só leitura)

O parser foi executado sobre **todos os 12.533 XMLs** da pasta `dados`
(recebidas, emitidas, eventos, inutilizações, CT-e, NFS-e): 10.797 NF-e
(100% layout 4.00, `dhEmi` com hora e offset, `protNFe` presente), 1.234
eventos, 121 `procInutNFe`/72 `cteProc`/302 `CompNfse` corretamente
classificados como desconhecidos, 298 arquivos com entidades XML e 9 com CDATA
lidos, encodings UTF-8/sem declaração. **1 arquivo real truncado** (emitida GDR,
4.096 bytes) foi rejeitado com `XmlParseError` — nenhuma nota "meio lida".
Grupos tributários encontrados e lidos: ICMS00/10/20/40/51/60/90/ST e
CSOSN 101/102/500/900; IPITrib/IPINT; PISAliq/PISNT/PISOutr (e COFINS
equivalentes); DIFAL em 6.961 itens; IBS/CBS em 2.734 itens.
Comparação tributária das 1.259 recebidas existentes (4.132 itens) contra o
banco — `cProd`, NCM, CFOP, unidade, quantidade, preço (na precisão da coluna),
total, ICMS (origem, modBC, CST/CSOSN, base, alíquota, valor), IPI, PIS,
datas, protocolo, natureza, `vNF`/`vProd`, emitente: **0 divergências**.

## Invariantes para os próximos PRs

- **Agregações econômicas de compra** (custo, `SupplierPriceHistory`,
  precificação, conciliação #609) **usam `direction = RECEBIDA` e
  `status = AUTHORIZED`**. Documentos `CANCELLED` existem para rastreabilidade
  fiscal e nunca entram em valor de compra.
- Supplier nunca é criado por importação; `SUPPLIER_MISSING` é resolvido pelo
  fluxo canônico da #611 e a reexecução preenche **só** `supplierId`.
- CC-e e eventos de manifestação ganharão um ledger próprio
  (`FiscalDocumentEvent`, frente posterior, também usado pela Focus);
  `FiscalCorrection` não é usado como substituto.
- NFS-e e CT-e não entram em `FiscalDocument` de NF-e — estruturas canônicas
  próprias na #607.

## Decisão: DB_Financeiro deixa de receber documentos novos (25/08/2026)

- O ETL antigo (`projeto_sql_xml/scripts/etl_completo.py` e
  `etl_cte_nfse.py` → tabelas `stg_*` do SQL Server) **não faz mais parte do
  fluxo fiscal**. XML é a entrada; o Avequi é o destino canônico; a Focus
  entregará o XML ao mesmo pipeline.
- O DB_Financeiro permanece **só como fonte legada/histórica** (reconstrução
  já feita pela reidratação #1123).
- As análises que ainda leem `stg_*` (qualificação de fornecedores, DRE,
  mapeamento nota→MP, conferências de chassi) ficam **congeladas em 12/06/2026**
  até serem migradas para consultar o Avequi.
- Qualquer execução futura do ETL antigo é **excepcional e consciente**, não
  rotina. A ferramenta de produção (`producao_v2`) usa o DB_Financeiro, mas
  **nenhuma tabela `stg_*`** — não é afetada.

## Como a Focus entra depois (não implementado aqui)

- **Focus-A**: cursor `versao` persistido por CNPJ + paginação até esgotar +
  habilitação por company + retomada.
- **Focus-B**: política de Ciência da Operação; download do XML
  (`/v2/nfes_recebidas/{chave}.xml`); `planFromXml(xml, ctx)` → `applyPlan`.
  Nenhum parser novo dentro do cliente Focus.
- **Focus-C**: processamento automático, retry, monitoramento, alerta de
  estagnação, feature flag.

O teste `received-nfe-import-core.spec.ts › mesmo caminho para o XML vindo da
Focus` prova que o texto da Focus e o arquivo local produzem o mesmo plano.
