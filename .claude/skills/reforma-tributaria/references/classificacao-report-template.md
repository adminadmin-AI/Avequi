# Relatório de Classificação Fiscal — {EMPRESA} — {DATA}

> Rascunho gerado pela skill `reforma-tributaria`. **Para validação e assinatura
> do contador/tributarista.** Nada aqui vai pra NF-e sem esse aval.

## Premissas (confirmar com o contador)
- Regime/CRT: {ex.: 3 — Lucro Real} · Filiais/UF: {PR, SC, RS, SP, MG}
- Benefícios/TTD considerados: {…ou "nenhum informado"}
- Data-base da NT: NT 2025.002-RTC v{…}

## Classificação por produto
| SKU | Produto | NCM | cClassTrib | CST IBS/CBS | CST ICMS | CST PIS/COFINS | Operação | CFOP | Fonte legal | Confiança | Revisar contador |
|---|---|---|---|---|---|---|---|---|---|---|---|
| REB01 | Reboque… | 87164000 | 000001 | 000 | 00 | 01 | VENDA_INTERNA | 5101 | LC214 art.X / NT2025.002 | Alta | Não |
| … | … | … | … | … | … | … | TRANSFERENCIA_INTERESTADUAL | 6152 | ADC49/LC204 | Média | **Sim** |

## Regras fiscais (TaxRule) propostas — prontas p/ importar após aval
| operationType | ncm | cfop | icmsCst | icmsAliq | pisCst | cofinsCst | cClassTrib | cbsCst | cbsAliq | ibsUfAliq | validFrom | validTo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| VENDA_INTERNA | 87164000 | 5101 | 00 | 18 | 01 | 01 | 000001 | 000 | 0.9 | 0.1 | 2026-01-01 | 2026-12-31 |

## Resumo de cobertura
- Produtos classificados (confiança alta): {n}
- Média (revisar): {n} · **Indefinidos (precisa contador): {n}**
- Produtos sem NCM: {n} · sem cClassTrib: {n}

## Pendências de documentação (bloqueiam a finalização)
- {lista do checklist de fontes-oficiais.md que ainda falta}

## Observações do tributarista
> _(espaço para o contador anotar ajustes antes de assinar)_
