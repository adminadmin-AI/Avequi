# Importação canônica de NF-e EMITIDA a partir do XML (histórico do emissor anterior)

> **Para quem chega agora:** a empresa emite NF-e pelo Wenext e o ERP tem o
> histórico dessas notas só até 13/06/2026 (reidratação #1123). Esta capacidade
> lê os XMLs das notas **emitidas pela CRD e pela GDR** (export do Qive: nfeProc,
> eventos de cancelamento, inutilizações) e reconstrói o documento fiscal no
> ERP — no mesmo lugar e no mesmo formato das 9.828 notas emitidas que já
> existem — sem tabela nova, sem venda nova, sem efeito operacional.
>
> É a **mesma fundação** do importador de NF-e RECEBIDA (#1128): parser,
> núcleo, escritor, protocolo de dry-run/commit. Só a direção muda.

## Princípio central

**Importar uma NF-e histórica não é realizar uma venda hoje.** O importador
reconstrói o *documento fiscal* e nada mais. Por construção (a interface do
escritor só expõe `fiscalDocument.create/update`), ele **não pode**:

- criar SalesOrder/venda, Customer ou Supplier;
- reservar ou movimentar estoque, criar expedição, comissão ou título a receber;
- disparar emissão ou qualquer evento de domínio (não há EventEmitter no
  caminho — nenhum listener de faturamento/cancelamento é acionado);
- consumir numeração, escolher série, criar/alterar faixa de inutilização
  (`FiscalVoidRange`) ou tocar a Focus — série/numeração pertencem à frente do
  emissor fiscal (Onda 4A) e são decididas com contador + Claudio + Focus/SEFAZ;
- inferir ou recalcular tributos: **XML sem grupo IBS/CBS ⇒ documento sem
  IBS/CBS** (nenhum CST/cClassTrib/alíquota é preenchido). O tratamento das
  notas emitidas sem o grupo após 03/08/2026 é decisão do contador, fora daqui.

## Peças (uma fundação, duas direções, duas origens)

```
[pasta local / Qive] ──┐
                       ├─► parseNfeDocument (nfe-xml/nfe-proc.parser.ts)
[Focus NF-e]         ──┘        │  nfeProc → NF-e · procEventoNFe → evento · procInutNFe → inutilização (só relatada)
                                ▼
                     buildTargetFromNfe / planBatch (inbound/received-nfe-import-core.ts, { direction })
                                │  RECEBIDA: company = destinatário, Supplier = emitente
                                │  EMITIDA : company = emitente,     destinatário preservado (Customer só medido)
                                ▼
                     applyPlan (inbound/received-nfe-import-writer.ts)
                                │  1 documento = 1 transação (doc + itens + impostos)
                                ▼
          FiscalDocument (direction=EMITIDA) · FiscalDocumentItem · FiscalDocumentItemTax
```

| Peça | Arquivo | O que muda para EMITIDA |
|---|---|---|
| Parser | `apps/api/src/fiscal/nfe-xml/nfe-proc.parser.ts` | Lê também `<total><IBSCBSTot>` (vIBS/vCBS) e classifica `procInutNFe` como `INUT` (antes caía em UNKNOWN). |
| Núcleo | `apps/api/src/fiscal/inbound/received-nfe-import-core.ts` | `buildTargetFromNfe(nfe, ctx, { direction })` e `planBatch(files, ctx, { direction })`; default `RECEBIDA` (comportamento anterior intacto). |
| Escritor | `apps/api/src/fiscal/inbound/received-nfe-import-writer.ts` | `planFromXml(xml, ctx, { direction })`; `toCreateData` inalterado (a direção vai no alvo). |
| CLI | `apps/api/scripts/import-nfe-xml.ts` | `--direction EMITIDA|RECEBIDA`. `import-received-nfe-xml.ts` virou atalho que fixa RECEBIDA. |

## Regras específicas de EMITIDA

| Tema | Regra |
|---|---|
| Company | **Sempre o CNPJ do `<emit>`**, fail-closed: CNPJ que não é company do ERP ⇒ `SKIPPED` com o CNPJ no motivo (contado como `companyDesconhecida`); CNPJ em mais de uma company ⇒ `CONFLICT`. Nunca mapa fixo, nunca fallback CRD ↔ GDR. |
| Destinatário | Preservado como está no XML: `recipientCnpj` recebe o CNPJ **ou o CPF** (só dígitos; a coluna é `VarChar(14)`); nome/endereço ficam no `xml` íntegro. Sem CNPJ/CPF ⇒ pendência `RECIPIENT_UNIDENTIFIED`, documento válido. |
| Customer | O schema **não tem FK `FiscalDocument → Customer`** (o vínculo com cliente passa por `salesOrderId`, que este importador nunca preenche). Por isso o Customer é só **medido**: match exato por documento (dígitos) dentro da company ⇒ `customerId` informativo no plano/relatório; ausente ⇒ `CUSTOMER_MISSING`; mais de um ⇒ `CUSTOMER_AMBIGUOUS`. Nunca cria, nunca casa por nome. |
| Intra-grupo | CRD emite para GDR ⇒ **dois documentos legítimos com a mesma chave**: `CRD/EMITIDA` (este importador) e `GDR/RECEBIDA` (importador de entrada). A unicidade é `(companyId, chave)`; a mesma chave na *outra* company nunca conta como existente; na *mesma* company com direção diferente ⇒ `CONFLICT`. Pendência `INTRA_GROUP` quando o destinatário também é company. |
| Impostos | Exatamente o XML (ICMS/IPI/PIS/COFINS/DIFAL/IBS-CBS). Sem grupo IBS/CBS em nenhum item ⇒ pendência `IBSCBS_ABSENT` (consultável depois: `cstCbs IS NULL` nos impostos do item). |
| Cancelamento | Evento 110111 com cStat 135/155 no mesmo lote ⇒ `status=CANCELLED` + `cancelledAt` + justificativa (INSERT) ou `UPDATE` de existente AUTHORIZED. Nunca reverte cancelamento. Evento sem a nota no lote ⇒ órfão, só relatado. |
| CC-e | Só relatada (`CCE_NOT_PERSISTED`) — não há CC-e nas saídas atuais. |
| Inutilização | `procInutNFe` é classificado e listado no relatório (`inutilizacoes`). **Nada é gravado em `FiscalVoidRange`.** |
| Faixas × notas | ALERTA `voidRangeOverlaps`: NF-e autorizada cujo número cai em faixa registrada no ERP como inutilizada. O importador não decide quem está certo — a evidência fiscal do próprio XML (protNFe cStat 100) prevalece para o documento; a situação real da faixa é assunto da SEFAZ/Focus. |
| Chave | Documentos gravados pela emissão própria (Focus) têm chave com prefixo `NFe`; o CLI compara pelos 44 dígitos para nunca reinserir uma nota emitida pelo ERP. |
| Numeração | O relatório mostra `numeracaoNoLote` (min/máx por company/série) **só como informação**. Não é ponteiro de corte: o Wenext continua emitindo; o último número real é obtido no D-1/instante do corte, pela frente 4A. |

Estados, UPDATE legítimo (XML ausente → preenchido; cancelamento registrado),
idempotência por comparação e evidência nominal são os mesmos do importador de
entrada — ver `importacao-nfe-recebida-xml.md`.

## Universo real (varredura local de 27/08/2026, só leitura)

3.075 XMLs do Qive baixados desde junho (entradas e saídas das duas empresas):

| Tipo | Quantidade | Tratamento |
|---|---|---|
| `nfeProc` cStat 100 (autorizada) | 2.787 | plano INSERT/UNCHANGED/UPDATE por direção |
| `nfeProc` cStat 150 (autorizada fora de prazo) | 1 | idem (aceito) |
| `procEventoNFe` 110111 (cancelamento, cStat 135) | 267 (240 nas saídas) | cancela o documento quando a nota vem no lote |
| `procEventoNFe` 110110 (CC-e, cStat 135) | 13 (só entradas) | relatada, não persistida |
| `procInutNFe` cStat 102 | 20 (14 CRD, 6 GDR, saídas) | classificada e relatada |
| chaves com mais de um arquivo | 7 | dedupe (idênticos) |

Saídas da CRD + GDR Reboques de maio a 27/08: 2.382 NF-e, **nenhuma com grupo
IBS/CBS** (inclusive as ~550 de agosto, já dentro da obrigação de 03/08/2026).
O importador preserva essa ausência; o tratamento é do contador.

Destinatários (fato relevante para o vínculo com Customer e para a Onda 4A):
**a maioria é pessoa física** — CRD: 1.869 NF-e para CPF (`indIEDest=9`) e
339 para CNPJ; GDR: 128 para CPF e 46 para CNPJ. Por isso `recipientCnpj`
aceita CPF, e a cobertura de Customer tende a ser baixa (os clientes PF do
SharePoint ainda não foram saneados no ERP).

Núcleo executado contra esses XMLs (sem banco, sem escrita, contexto só com os
CNPJs das companies): EMITIDA ⇒ CRD 2.202 INSERT (214 canceladas por evento,
15 intra-grupo, série 1, nº 13.222–15.452), GDR 174 INSERT (25 canceladas,
nº 4.481–4.664); 405 arquivos de terceiros ⇒ SKIPPED (emitente não é company);
20 inutilizações relatadas (todas de um número, cStat 102 — são as lacunas do
próprio Wenext, não as faixas 14517–19999 registradas no ERP); 2 eventos órfãos;
7 duplicatas idênticas; 0 inválidos. Contra o banco real, as notas de 01/05 a
13/06 virarão UNCHANGED/UPDATE em vez de INSERT.

Sobreposição com o ERP: notas emitidas de 01/05 a 13/06 já existem
(reidratação) — CRD 691 (série 1, nº 13.222–13.922) e GDR 88 (nº 4.436–4.529,
41 sem XML). Para essas, o plano esperado é `UNCHANGED` ou `UPDATE` (só XML
ausente / cancelamento); qualquer divergência de fato fiscal vira `CONFLICT`
para revisão humana. Cinco itens da CRD estão sem `nItem` no ERP — esses
documentos cairão em `CONFLICT` por desenho (nunca reescrevemos itens).

## Uso

```bash
# dry-run (padrão) — nenhuma escrita
ts-node scripts/import-nfe-xml.ts --direction EMITIDA \
  --dir <pasta>/notas_saida_crd --dir <pasta>/notas_saida_gdr --dir <pasta>/notas_entrada_gdr \
  --report ./relatorio

# commit — exige dry-run do MESMO dia e da MESMA direção, com o mesmo conjunto nominal; aborta com CONFLICT
ts-node scripts/import-nfe-xml.ts --direction EMITIDA --dir ... --report ./relatorio --commit
```

Por que incluir `notas_entrada_gdr` no lote EMITIDA: as notas que a CRD emite
para a GDR aparecem lá (na visão da GDR são entradas). O núcleo lê o `<emit>`
e as classifica corretamente como EMITIDA da CRD; as notas de terceiros dessa
pasta caem em `SKIPPED` (emitente não é company).

O relatório (`import-nfe-emitida-dryrun.json`) traz: arquivos lidos, estados,
por company (INSERT/UNCHANGED/UPDATE/CONFLICT/SKIPPED/INVALID, cliente
vinculável/ausente/ambíguo, destinatário não identificado, intra-grupo,
canceladas, com/sem IBS/CBS, período), `companyDesconhecida`, lista nominal de
inserções (chave, empresa, data, status, série, número, destinatário, total,
cliente, IBS/CBS, pendências), `customerMissing`, `semIbsCbs`,
`voidRangeOverlaps`, `inutilizacoes`, órfãos, duplicatas, inválidos e a
evidência nominal do gate.

## Relação com a Onda 4A (emissor fiscal)

- **Antes do corte** da 4A é preciso conhecer: documentos emitidos até o corte,
  série, último número real, company, ausência de colisão, situação real na
  SEFAZ/Focus e plano de continuidade. Isso vem do D-1 e da frente 4A, não deste
  backfill.
- **O backfill completo não é blocker funcional do corte.** Nada no código de
  emissão consulta o histórico importado para numerar ou emitir; a única
  interseção é a unicidade `(companyId, issuerCnpj, series, number, type)`, que
  só colidiria se o ERP fosse emitir um número que o Wenext já usou — risco da
  decisão de série/numeração da 4A, não da importação.
- Prazo combinado: **até 30 dias após o corte da 4A e obrigatoriamente antes da
  4B**. Os 14 dias de hypercare da 4A (gate mínimo para outro go-live) e os 30
  dias de acompanhamento (DONE final) são coisas distintas; o backfill não
  altera nenhum dos dois.

## Segurança operacional

Mesma do importador de entrada: dry-run padrão; `--commit` só com evidência do
dia e da direção; aborta com `CONFLICT`; 1 documento = 1 transação; reexecução
⇒ `UNCHANGED`. **Nenhum dry-run contra produção foi executado nesta PR** — o
futuro dry-run real exige autorização separada.

## Fora desta PR (decisões pendentes)

- FK `FiscalDocument → Customer` (hoje o vínculo é só medido). Se a direção
  quiser vínculo persistido, é migration + regra de resolução — decisão do
  Rafael.
- Tratamento das 6 faixas registradas em 13/07 sem protocolo (14517–19999) e
  das ~420 NF-e autorizadas dentro delas: verificar na SEFAZ/Focus; nada é
  alterado por aqui.
- Notas emitidas sem IBS/CBS após 03/08/2026: decisão do contador.
