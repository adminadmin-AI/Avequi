# Focus-A — sincronização incremental de NF-e recebidas (#608)

> **Para quem chega agora:** a Focus guarda as notas que fornecedores emitem
> contra cada CNPJ da empresa e as entrega por uma lista com um número de
> `versao` que só cresce. Este passo faz o ERP puxar essa lista **de onde
> parou**, página por página, guardando um cursor por empresa — sem depender
> de download manual e sem confundir "a Focus falhou" com "não há notas".
> Ele ainda **não** baixa XML nem grava `FiscalDocument`: isso é o Focus-B,
> que reutiliza o parser/importador da #1128. **Nada liga sozinho no deploy:**
> cada empresa precisa ser habilitada explicitamente (gate, default OFF).

## Desenho

```
cron 07h / POST /fiscal/manifest/sync
   └─ gate por company: SystemParameter "focus.nfe_recebidas.enabled" = 'true'?
        (cron: desligada ⇒ pula em silêncio · POST: desligada ⇒ 409)
   └─ ManifestService.syncReceivedNfes(companyId)
        ├─ lease por company (SystemParameter, compare-and-swap) → 409 se já roda
        ├─ estado: SystemParameter(companyId, "focus.nfe_recebidas.sync:<cnpj>") → JSON
        ├─ runIncrementalSync (núcleo puro, received-nfe-sync.core.ts)
        │    loop: fetchPage(cursor) → GET /v2/nfes_recebidas?cnpj=&versao=cursor
        │          guarda: cnpj_destinatario ≠ company ⇒ erro (nada persistido)
        │          persistPage (NfeManifest): nova → cria com estado real da Focus
        │                                    conhecida + versao maior → alteração durável
        │                                    mesma versao → só focusSeenAt
        │          cursor = X-Max-Version (ou max versao dos itens) → saveState
        │          até: página < 100 E X-Total-Count ≤ itens da página (ou maxPages)
        ├─ GET  /fiscal/manifest/sync/state    → cursor, último sync, último erro, enabled
        ├─ GET  /fiscal/manifest/sync/settings → { enabled }
        └─ PATCH /fiscal/manifest/sync/settings { enabled } (fiscal.manifestation.sync, auditado)
```

## Gate por company — `focus.nfe_recebidas.enabled` (default OFF)

- Flag canônica no `FeatureFlagService` (`FeatureFlag.FOCUS_NFE_RECEBIDAS_ENABLED`),
  mesmo mecanismo do `renave.enabled`: valor em `SystemParameter` por
  company, **fail-closed** (ausente/inválido ⇒ OFF). Nada fixo para GDR/CRD.
- **Cron**: company desligada é pulada em silêncio — sem chamada à Focus, sem
  cursor, sem `NfeManifest`, sem `FAILED`, sem log de erro.
- **POST /fiscal/manifest/sync**: company desligada ⇒ **409** com a
  instrução de habilitar; não há bypass.
- **Habilitar** é ato explícito: `PATCH /fiscal/manifest/sync/settings
  { "enabled": true }` (permissão `fiscal.manifestation.sync` — FISCAL e
  admins), grava `'true'`/`'false'` e registra `AuditLog`
  (`FOCUS_NFE_RECEBIDAS_SYNC_ENABLED/DISABLED`). Company sem CNPJ válido não
  pode ser habilitada. Sem UPDATE manual no banco.
- Estado operacional pretendido no primeiro deploy: **todas OFF**. CRD é a
  candidata a ligar após validação; GDR Reboques só depois que a habilitação
  na Focus e o token no Railway forem confirmados; GDR Guarapuava, Avecchi e
  Usinagem J A ficam OFF até decisão.

## O que a Focus devolve (documentação oficial, `consultar_nfes_recebidas`)

- `versao` na query: "*Busca apenas os documentos cuja versão seja maior que o
  parâmetro recebido*" — estritamente **maior**, por isso o cursor guarda a
  maior versão **já persistida** e a busca seguinte não a repete.
- `versao` no item: "*único entre todos os documentos do mesmo CNPJ e
  atualizado a cada alteração nesta nota fiscal*". Uma nota já conhecida
  **volta a aparecer** com versão maior quando recebe carta de correção,
  cancelamento ou manifestação.
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
  os 50 `NfeManifest` criados em jul/2026 ficaram com `supplierCnpj=''` e
  `nfeNumber NULL` por isso; continuam aceitos como fallback.

## Estado do conector no `NfeManifest` (migration `20260825200000_nfe_manifest_focus_state`)

Sete colunas anuláveis, 100% aditivas, nenhum backfill:

| Coluna | Significado |
|---|---|
| `focusVersion` | última `versao` vista na Focus para a chave |
| `focusProcessedVersion` | última `versao` consumida pelo **Focus-B** (`NULL` = nunca) |
| `focusSituacao` | `autorizada` / `cancelada` / `denegada` como a Focus devolveu |
| `focusManifestacao` | `nulo` / `ciencia` / `confirmacao` / `desconhecimento` / `nao_realizada` |
| `focusNfeCompleta` | a Focus já tem o XML completo |
| `focusSeenAt` | última vez que a chave veio numa página |
| `focusChangedAt` | última vez que `focusVersion` subiu (reaparição) |

**Fila do Focus-B** = `focusVersion IS NOT NULL AND (focusProcessedVersion IS
NULL OR focusProcessedVersion < focusVersion)` (índice
`companyId, focusProcessedVersion`). Assim, **nenhuma versão da Focus é
consumida e esquecida**: a reaparição fica gravada na própria linha antes de o
cursor avançar, e o Focus-B marca `focusProcessedVersion = focusVersion` ao
processar (cancelamento/CC-e/manifestação viram evento fiscal lá — candidato
ao `FiscalDocumentEvent` aditivo). `NfeManifest` continua sendo só
detecção/manifestação/estado do conector; a verdade do documento é
`FiscalDocument`.

## Regras de persistência (`persistReceivedPage`)

- **Chave nova** → `NfeManifest` criado com o **estado real** da Focus:
  `status` derivado de `manifestacao_destinatario` (`nulo` → PENDING,
  `ciencia` → CIENCIA, `confirmacao` → CONFIRMED, `desconhecimento` → UNKNOWN,
  `nao_realizada` → NOT_PERFORMED) — nunca PENDING artificial para nota
  histórica já manifestada.
- **Chave conhecida com `versao` maior** → `focusVersion`, `focusChangedAt`,
  `focusSituacao`, `focusManifestacao`, `focusNfeCompleta` atualizados;
  `status` só é **promovido** de PENDING para o estado da Focus — o ERP nunca
  é rebaixado (um CONFIRMED continua CONFIRMED). Conta em `lastRunUpdated`.
- **Chave conhecida com a mesma versão** → só `focusSeenAt` (reexecução
  idempotente: não duplica nem perde o sinal).
- **Enriquecimento seguro** (toda chave conhecida): preenche **apenas** o que
  está vazio/nulo — `supplierCnpj=''`, `nfeNumber`, `series`, `supplierName`,
  `issueDate`, `totalValue` — com o que a Focus devolveu agora; nunca
  sobrescreve valor preenchido; nunca toca `FiscalDocument`.
- **Os 50 `NfeManifest` antigos da CRD**: no catch-up (cursor 0) todos
  reaparecem; cada um recebe `supplierCnpj` (= `documento_emitente`, que
  bate 50/50 com o CNPJ da chave e com `FiscalDocument.issuerCnpj`),
  `nfeNumber`/`series` derivados da chave (batem 50/50 com
  `FiscalDocument.number/series`) e o estado do conector. Nome, data e valor,
  já preenchidos, não mudam. Nenhum script de UPDATE isolado.
- Cursor só avança **depois** de `persistPage` da página inteira.

## Fila e alerta de PENDING sem ruído

- `findPending`, `findOverdue`, `checkOverdueManifests` e o contador `overdue`
  de `getStats` excluem `focusSituacao ∈ {cancelada, denegada}` — nota
  cancelada/denegada não é manifestável e não entra na fila nem no alerta.
- Notas históricas já manifestadas nascem com o status real (CIENCIA/
  CONFIRMED/…), não como PENDING.
- O alerta "> 30 dias" usa `createdAt` do `NfeManifest`: o catch-up cria as
  linhas hoje, portanto **não dispara no dia seguinte**; só 30 dias depois, e
  apenas para o que continuar PENDING de verdade (manifestação `nulo`,
  situação autorizada).

## Regras de sincronização

- **Cursor**: `versao` máxima confirmada, por company/CNPJ. Persistido no
  `SystemParameter` (estrutura genérica já usada por feature flags e pelo
  conector Mercado Livre). Chave namespaced `provider.resource.sync:<id
  externo>`; nada fixo para GDR/CRD.
- **Estado (JSON)**: `cursor`, `lastRunStatus` (NEVER/RUNNING/OK/FAILED),
  `lastSyncAt`, `lastSuccessAt`, `lastError`, `lastRunSeen`, `lastRunNew`,
  `lastRunUpdated`, `lastRunPages`, `totalCount`.
- **Paginação**: continua enquanto a página vier cheia (100) **ou** o
  `X-Total-Count` da própria página disser que sobrou registro fora dela;
  termina em página vazia. Página não vazia sem avanço de cursor ⇒ erro
  (`SyncNoProgressError`), nunca loop infinito. `maxPages` (500) é teto de
  segurança. O cursor nunca pula documento porque só assume o `X-Max-Version`
  da página **já persistida**.
- **Retomada**: falha no meio ⇒ estado `FAILED` com a mensagem, cursor na
  última página confirmada; a próxima execução recomeça dali.
- **Exclusão mútua por company (cron × POST manual)**: mutex em processo +
  lease no banco por compare-and-swap (`UPDATE … WHERE value = <lido>`,
  vencimento 30 min renovado a cada página). O segundo recebe **409** e não
  toca cursor nem `NfeManifest`. Corrida residual no `NfeManifest` (P2002) é
  tratada como "já existe".
- **Falha ≠ 0 notas**: `fetchReceivedNfesPage` lança `FocusReceivedNfeError`
  em erro de rede/HTTP/corpo inválido; o método antigo `fetchReceivedNfes`
  (que devolvia `[]`) fica `@deprecated`. O cron trata cada company em
  `try/catch` próprio: a falha de uma não impede as demais.
- **Isolamento entre companies**: token por company
  (`FOCUS_NFE_TOKEN__<companyId>`, #695) com fallback no global; estado por
  company; `NfeManifest` por company. CNPJ **não habilitado** na conta do
  token ⇒ Focus responde `400 CNPJ não autorizado` ⇒ `FAILED` explícito; item
  com `cnpj_destinatario` ≠ company aborta **antes** de persistir.

## Fora deste passo (Focus-B/C) — e o que o Focus-B vai precisar

- **XML só depois de manifestar**: `nfe_completa=true` indica que a Focus já
  tem o XML (`GET /v2/nfes_recebidas/{chave}.xml`). O Focus-B depende de uma
  **política de Ciência da Operação** (evento fiscal real, decisão separada):
  automática para toda nota detectada, ou restrita/manual — e de como
  garantir a manifestação conclusiva quando aplicável. `pendente_ciencia=1`
  e `pendente=1` existem na API para listar só o que falta manifestar.
- **Consumir a fila** `focusVersion > focusProcessedVersion`: reaparição =
  cancelamento/CC-e/manifestação → refletir em `FiscalDocument`
  (`planFromXml → applyPlan` da #1128 + evento) e marcar
  `focusProcessedVersion`.
- Retry operacional; alerta de estagnação; health-check de produção.

## Testes

`received-nfe-sync.core.spec.ts`: múltiplas páginas, sem novidade, novidade
posterior, falha no meio + retomada, idempotência, duas companies, erro da
Focus nunca vira lista vazia, sem avanço ⇒ erro, sem X-Max-Version, `maxPages`,
página < 100 com X-Total-Count maior, sem X-Total-Count, nota de outro CNPJ,
**mesma chave versao 100 → 150 (alteração registrada, cursor 150, reexecução
não duplica nem perde)**, `manifestStatusFromFocus`, estado corrompido,
normalização com os nomes reais e antigos.
`manifest.service.spec.ts`: primeira execução, idempotência, FAILED sem mover
cursor, `getSyncState`, item real da Focus, outro CNPJ, P2002, cron × POST
simultâneos (409), lease em outra instância/vencido, CAS perdido, companies
independentes, **gate OFF ⇒ 409 sem tocar nada**, habilitar/desabilitar
auditado, company sem CNPJ não habilita, **reaparição com versão maior
(persistida antes do cursor)**, ERP nunca rebaixado, **os 50 antigos
corrigidos só nos campos vazios**, catch-up com estado real da Focus,
fila/alerta sem cancelada/denegada.
`alert.scheduler.manifest-sync.spec.ts`: cron pula companies desligadas em
silêncio; falha de uma company não impede as demais.
