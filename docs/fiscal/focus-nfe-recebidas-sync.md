# Focus-A — sincronização incremental de NF-e recebidas (#608)

> **Para quem chega agora:** a Focus guarda as notas que fornecedores emitem
> contra cada CNPJ da empresa e as entrega por uma lista com um número de
> `versao` que só cresce. Este passo faz o ERP puxar essa lista **de onde
> parou**, página por página, guardando um cursor por empresa — sem depender
> de download manual e sem confundir "a Focus falhou" com "não há notas".
> Ele ainda **não** baixa XML nem grava `FiscalDocument`: isso é o Focus-B,
> que reutiliza o parser/importador da #1128.

## Desenho

```
cron 07h / POST /fiscal/manifest/sync
   └─ ManifestService.syncReceivedNfes(companyId)
        ├─ lease por company (SystemParameter, compare-and-swap) → 409 se já roda
        ├─ estado: SystemParameter(companyId, "focus.nfe_recebidas.sync:<cnpj>") → JSON
        ├─ runIncrementalSync (núcleo puro, received-nfe-sync.core.ts)
        │    loop: fetchPage(cursor) → GET /v2/nfes_recebidas?cnpj=&versao=cursor
        │          guarda: cnpj_destinatario ≠ company ⇒ erro (nada persistido)
        │          persistPage (NfeManifest, idempotente por companyId+chave)
        │          cursor = X-Max-Version (ou max versao dos itens) → saveState
        │          até: página < 100 E X-Total-Count ≤ itens da página (ou maxPages)
        └─ GET /fiscal/manifest/sync/state → cursor, último sync, último erro
```

## O que a Focus devolve (documentação oficial, `consultar_nfes_recebidas`)

- `versao` na query: "*Busca apenas os documentos cuja versão seja maior que o
  parâmetro recebido*" — estritamente **maior**, por isso o cursor guarda a
  maior versão **já persistida** e a busca seguinte não a repete.
- `versao` no item: "*único entre todos os documentos do mesmo CNPJ e
  atualizado a cada alteração nesta nota fiscal*". Uma nota já conhecida
  **volta a aparecer** com versão maior quando recebe carta de correção,
  cancelamento ou manifestação — é o sinal que o Focus-B precisa para
  refletir cancelamento/CC-e no `FiscalDocument`.
- "*Este endpoint retorna as 100 primeiras notas encontradas*"; cabeçalhos
  `X-Total-Count` (total incluindo os que ficaram fora do limite de 100) e
  `X-Max-Version` ("*utilize este cabeçalho na próxima busca de versão*").
- Campos do resumo: `chave_nfe`, `versao`, `nome_emitente`,
  **`documento_emitente`** (CNPJ ou CPF), `cnpj_destinatario`, `data_emissao`,
  `valor_total`, `situacao` (autorizada|cancelada|denegada),
  `manifestacao_destinatario` (nulo|ciencia|confirmacao|desconhecimento|
  nao_realizada), **`nfe_completa`** (a Focus só tem o XML completo depois de
  manifestar), `tipo_nfe`, `digest_value`, carta de correção/cancelamento.
  O resumo **não traz número/série**: são derivados da chave (posições
  23–25 = série, 26–34 = nNF). O nome antigo `cnpj_emitente` era um engano —
  os 50 `NfeManifest` criados em jul/2026 ficaram com `supplierCnpj=''` por
  isso; continuam aceitos como fallback.

## Regras

- **Cursor**: `versao` máxima confirmada, por company/CNPJ. Persistido no
  `SystemParameter` (estrutura genérica já usada por feature flags e pelo
  conector Mercado Livre) — **sem tabela nova, sem migration**. Chave
  namespaced `provider.resource.sync:<id externo>`; nada fixo para GDR/CRD.
- **Estado (JSON)**: `cursor`, `lastRunStatus` (NEVER/RUNNING/OK/FAILED),
  `lastSyncAt`, `lastSuccessAt`, `lastError`, `lastRunSeen`, `lastRunNew`,
  `lastRunPages`, `totalCount` (X-Total-Count no início da execução).
- **Paginação**: continua enquanto a página vier cheia (100) **ou** o
  `X-Total-Count` da própria página disser que sobrou registro fora dela;
  termina em página vazia. Página não vazia sem avanço de cursor ⇒ erro
  (`SyncNoProgressError`), nunca loop infinito. `maxPages` (500) é teto de
  segurança: o resto fica para a próxima execução. O cursor nunca pula
  documento porque só assume o `X-Max-Version` da página **já persistida**.
- **Retomada**: o cursor só avança **depois** de persistir a página. Falha no
  meio ⇒ estado `FAILED` com a mensagem, cursor na última página confirmada;
  a próxima execução recomeça dali. Persistência idempotente ⇒ nada duplica.
- **Exclusão mútua por company (cron × POST manual)**: dois níveis.
  1. Mutex em processo (`Map` por company) — cron e POST no mesmo container.
  2. Lease no banco: entrar = trocar o estado persistido de (não-RUNNING ou
     RUNNING com linha sem atualização há ≥ 30 min) para RUNNING com
     `UPDATE … WHERE value = <valor lido>` (compare-and-swap; mesma guarda
     otimista dos importadores fiscais). Só uma execução troca; a outra
     recebe **409** e não toca cursor nem `NfeManifest`. Como o estado é
     regravado a cada página, uma execução viva renova o lease sozinha; um
     processo morto libera após 30 min. Sem tabela de lock, sem advisory
     lock, sem transação longa.
  Corrida residual no `NfeManifest` (P2002) é tratada como "já existe".
- **Falha ≠ 0 notas**: `fetchReceivedNfesPage` lança
  `FocusReceivedNfeError` em erro de rede/HTTP/corpo inválido; o método antigo
  `fetchReceivedNfes` (que devolvia `[]`) fica `@deprecated`. O cron trata
  cada company em `try/catch` próprio: a falha de uma não impede as demais.
- **Isolamento entre companies**: token por company
  (`FOCUS_NFE_TOKEN__<companyId>`, #695) com fallback no global; estado por
  company; `NfeManifest` por company. Um CNPJ **não habilitado** na conta do
  token recebe da Focus `400 requisicao_invalida — CNPJ … não autorizado`
  ⇒ `FAILED` explícito. Se, ainda assim, algum item vier com
  `cnpj_destinatario` diferente do CNPJ da company, a execução aborta
  (`SyncForeignRecipientError`) **antes** de persistir qualquer coisa.
- **Catch-up**: primeira execução parte de `versao=0` e traz tudo que a
  Focus guarda para o CNPJ. Notas que já existem em `FiscalDocument` (vindas
  do Qive) apenas ganham a linha de detecção em `NfeManifest`; nada é
  reescrito. Atenção: o alerta "NF-e sem manifestação > 30 dias" (cron 09h)
  conta `NfeManifest` PENDING por `createdAt` — depois do primeiro catch-up
  ele passa a refletir o backlog real de manifestação.
- **O que é persistido**: só a camada de "documentos detectados" já existente
  (`NfeManifest`: chave, número/série, emitente, data, valor, `PENDING`).
  Documento já existente **não é alterado** (status/manifestação são do ERP).
  `NfeManifest` não é uma segunda verdade fiscal: é detecção + manifestação;
  a verdade fiscal continua sendo `FiscalDocument` via XML/parser da #1128.

## Fora deste passo (Focus-B/C) — e o que o Focus-B vai precisar

- **XML só depois de manifestar**: o resumo vem sem XML; `nfe_completa=true`
  indica que a Focus já tem o XML completo (após ciência/confirmação).
  Endpoint: `GET /v2/nfes_recebidas/{chave}.xml`. Logo o Focus-B depende de
  uma **política de Ciência da Operação** (evento fiscal real, decisão
  separada): automática para toda nota detectada, ou restrita/manual — e de
  como garantir a manifestação conclusiva (confirmação/desconhecimento/não
  realizada) quando aplicável. `pendente_ciencia=1` e `pendente=1` existem
  na API para listar só o que falta manifestar.
- **Reaparição com versão maior** = alteração (cancelamento, CC-e,
  manifestação): o Focus-B deve reprocessar a nota em vez de ignorar; hoje o
  Focus-A só conta (`lastRunSeen − lastRunNew`).
- `planFromXml → applyPlan` (#1128) para `FiscalDocument`; retry
  operacional; alerta de estagnação; feature flag.

## Testes

`received-nfe-sync.core.spec.ts`: múltiplas páginas, sem novidade, novidade
posterior, falha no meio + retomada sem perda/duplicata, reexecução idempotente,
duas companies independentes, erro da Focus nunca vira lista vazia, sem avanço
⇒ erro, sem cabeçalho X-Max-Version, `maxPages`, página < 100 com
X-Total-Count maior (continua), sem X-Total-Count (página cheia), nota de outro
CNPJ (aborta sem persistir), estado corrompido, normalização com os nomes
reais da API (`documento_emitente`, `cnpj_destinatario`, `nfe_completa`,
número/série da chave) e com os antigos.
`manifest.service.spec.ts`: primeira execução, idempotência, falha ⇒ FAILED sem
mover cursor, `getSyncState`, item real da Focus, outro CNPJ ⇒ FAILED, P2002
tolerado, cron × POST simultâneos (409 para o segundo), lease RUNNING em outra
instância (409) e vencido (retoma), compare-and-swap perdido (409), companies
diferentes não se bloqueiam.
