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
        ├─ estado: SystemParameter(companyId, "focus.nfe_recebidas.sync:<cnpj>") → JSON
        ├─ runIncrementalSync (núcleo puro, received-nfe-sync.core.ts)
        │    loop: fetchPage(cursor) → GET /v2/nfes_recebidas?cnpj=&versao=cursor
        │          persistPage (NfeManifest, idempotente por companyId+chave)
        │          cursor = X-Max-Version (ou max versao dos itens) → saveState
        │          até página < 100 itens (ou maxPages)
        └─ GET /fiscal/manifest/sync/state → cursor, último sync, último erro
```

- **Cursor**: `versao` máxima confirmada, por company/CNPJ. Persistido no
  `SystemParameter` (estrutura genérica já usada por feature flags e pelo
  conector Mercado Livre) — **sem tabela nova, sem migration**. Chave
  namespaced `provider.resource.sync:<id externo>`; nada fixo para GDR/CRD.
- **Estado (JSON)**: `cursor`, `lastRunStatus` (NEVER/RUNNING/OK/FAILED),
  `lastSyncAt`, `lastSuccessAt`, `lastError`, `lastRunSeen`, `lastRunNew`,
  `lastRunPages`, `totalCount` (X-Total-Count no início da execução).
- **Paginação**: a Focus devolve no máximo 100 por chamada; o loop segue
  enquanto a página vier cheia. Página não vazia sem avanço de cursor ⇒ erro
  (`SyncNoProgressError`), nunca loop infinito. `maxPages` (500) é teto de
  segurança: o resto fica para a próxima execução.
- **Retomada**: o cursor só avança **depois** de persistir a página. Falha no
  meio ⇒ estado `FAILED` com a mensagem, cursor na última página confirmada;
  a próxima execução recomeça dali. Persistência idempotente ⇒ nada duplica.
- **Falha ≠ 0 notas**: `fetchReceivedNfesPage` lança
  `FocusReceivedNfeError` em erro de rede/HTTP/corpo inválido; o método antigo
  `fetchReceivedNfes` (que devolvia `[]`) fica `@deprecated`.
- **Isolamento**: token por company (`FOCUS_NFE_TOKEN__<companyId>`, #695),
  estado por company, `NfeManifest` por company.
- **Catch-up**: primeira execução parte de `versao=0` e traz tudo que a
  Focus guarda para o CNPJ (ao habilitar um CNPJ a Focus busca os últimos
  ~90 dias).
- **O que é persistido**: só a camada de "documentos detectados" já existente
  (`NfeManifest`: chave, número/série, emitente, data, valor, `PENDING`).
  Documento já existente não é alterado (status/manifestação são do ERP).

## Fora deste passo (Focus-B/C)

Ciência automática e política de manifestação; download do XML
(`/v2/nfes_recebidas/{chave}.xml`); `planFromXml → applyPlan` (#1128) para
`FiscalDocument`; retry operacional; alerta de estagnação; feature flag.

## Testes

`received-nfe-sync.core.spec.ts`: múltiplas páginas, sem novidade, novidade
posterior, falha no meio + retomada sem perda/duplicata, reexecução idempotente,
duas companies independentes, erro da Focus nunca vira lista vazia, sem avanço
⇒ erro, sem cabeçalho X-Max-Version, `maxPages`, estado corrompido, normalização.
`manifest.service.spec.ts`: primeira execução, idempotência, falha ⇒ FAILED sem
mover cursor, `getSyncState`.
