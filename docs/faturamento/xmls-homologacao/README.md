# XMLs de Homologação — Referência

NF-e autorizadas pela SEFAZ/PR em **ambiente de homologação** (`tpAmb=2`, sem valor fiscal) durante a validação do faturamento em 02/07/2026. Servem como **referência de payload correto** para o `fiscal-mapper` e como massa de comparação para regressões.

> Consulta no portal público da SEFAZ retorna "chave inexistente" — comportamento esperado: o portal só consulta produção. A autenticidade é atestada pelo protocolo (`<nProt>`) no grupo `<infProt>`.

## Notas do script E2E (`test-focus-e2e.ts`)

| Arquivo | Nota | O que valida |
|---|---|---|
| `nfe-001-veiculo-difal.xml` | nº 1 | Primeira NF-e autorizada — veicProd + DIFAL PR→SC + PIS 49/COFINS 99 |
| `nfe-002-primeira-ibscbs.xml` | nº 2 | Primeira com grupo `<IBSCBS>` (CBS 0,9% + IBS UF 0,1%) — *sem veicProd (bug do payload aninhado, corrigido no PR #441)* |
| `nfe-003-completa-veicprod-ibscbs-difal.xml` | nº 3 | **Nota de referência**: veicProd + IBSCBS + ICMSUFDest juntos |
| `nfe-027-endereco-oficial.xml` | nº 27 | Emitente com endereço oficial da Receita (Rua Antônio Singer, 4075) |

## Notas da auditoria (`audit-homologacao.ts`, run 1783038493431)

| Arquivo | Cenário |
|---|---|
| `audit-A1-interna-pr.xml` | Venda interna PR→PR, sem DIFAL |
| `audit-A2-sp-difal-fcp.xml` | PR→SP, DIFAL 18% — ⚠️ FCP 0% (pendência #445, esperado 2%) |
| `audit-A3-mg-difal-CANCELADA.xml` | PR→MG, DIFAL 18% — **cancelada** (ver evento) |
| `audit-A3-...-evento-cancelamento.xml` | Evento de cancelamento homologado (nProt próprio) |
| `audit-A4-rs-difal-cce.xml` | PR→RS, DIFAL 17% — recebeu CC-e (ver evento) |
| `audit-A4-...-evento-cce.xml` | Carta de Correção autorizada |
| `audit-A5-rj-difal.xml` | PR→RJ, DIFAL 20% — ⚠️ FCP 0% (#445) |
| `audit-B2-pj-sem-ie.xml` | PJ sem IE (indIEDest=2), sem DIFAL |
| `audit-C1-multi-item.xml` | 2 itens: reboque com veículo + acessórios |
| `audit-C2-sem-veiculo.xml` | Item comum, sem grupo veicProd |
| `audit-C3-arredondamento.xml` | 3 × R$ 1.234,56 — arredondamentos |
| `audit-C4-desconto.xml` | Item com desconto (vNF = bruto − desconto) |
| `audit-D2-devolucao-entrada.xml` | Devolução de venda: entrada, finalidade 4, forma pagamento 90, nota referenciada |
| `audit-E2-mix-ibscbs.xml` | Item com IBS/CBS + item sem, na mesma nota |

Relatório completo da auditoria: [`../auditoria-homologacao-2026-07-02.md`](../auditoria-homologacao-2026-07-02.md)

## Para rebaixar qualquer XML

```bash
curl -u "$FOCUS_NFE_TOKEN:" https://homologacao.focusnfe.com.br/v2/nfe/<REF>
# → campo caminho_xml_nota_fiscal
```
