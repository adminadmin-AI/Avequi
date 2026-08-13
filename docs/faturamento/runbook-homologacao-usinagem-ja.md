# Runbook — 1ª nota da USINAGEM J A (Simples Nacional)

**Épico:** #1068 · **Estado em 13/08/2026:** tudo pronto, aguardando liberação do responsável técnico pela Focus.

## Estado atual

| Item | Estado |
|---|---|
| Código do CSOSN/ICMSSN | ✅ na main (#1069, #1070) |
| Regra de coerência CRT × situação tributária | ✅ na main (#1079) |
| Cenários com dados reais | ✅ `apps/api/scripts/homolog-simples.ts` |
| Token de homologação da cliente | ✅ `apps/api/.env.homolog-usija.local` (fora do git) |
| Rejeição 974 — responsável técnico | ⏳ **liberação pedida à Focus** |
| `pCredSN` real | ⏳ **pendente do contador dela** |

## Rejeições já vencidas

| Rejeição | Causa | Como foi resolvida |
|---|---|---|
| `CNPJ do emitente não autorizado` | token da GDR não cobre o CNPJ dela | token próprio da cliente |
| `209 IE do emitente invalida` | IE cortada para 9 dígitos | IE do PR tem **10** (8 + 2 verificadores) → `9124135785` |
| `600 CSOSN incompativel com Nao Contribuinte` | destinatário era PF de teste | CSOSN 101 exige contribuinte → usar a CRD. Virou regra no validador |

## A operação

| Campo | Valor |
|---|---|
| Emitente | USINAGEM J A LTDA · 62.484.006/0001-39 · IE 9124135785 · **CRT 1** |
| Destinatário | CRD IND. COM. REBOQUES · 30.284.708/0001-82 · IE 9078144677 · CRT 3 |
| Produto | PONTA DE EIXO · NCM 8716.90.90 · CEST 01.127.00 |
| Quantidade / valor | 100 UN × R$ 17,00 = R$ 1.700,00 |
| Origem | 0 — nacional |
| CFOP | **5101** — venda de produção própria |
| CSOSN | **101** — com repasse de crédito |
| Pagamento | 4x de 7 em 7 dias (tPag 15) |

**Por que 5101 e não industrialização por encomenda:** ela compra o material e entrega a peça pronta. Se a CRD remetesse o insumo, seria 5124/5902.

**Por que NF-e e não NFS-e:** esta operação é circulação de mercadoria. A NFS-e dela (#1077) atende clientes onde presta serviço puro. A decisão é por operação, não por empresa.

**Por que a ST não incide** apesar do CEST: a CRD emprega a peça no processo produtivo dela, e o Convênio ICMS 142/2018 afasta a ST no destino a industrialização. Se um dia vender para revenda, cai no #1082 (motor não calcula ST).

## Quando a Focus liberar

```bash
cd ~/Avequi
set -a && . apps/api/.env.homolog-usija.local && set +a

# com o pCredSN confirmado pelo contador:
P_CRED_SN=1.44 npx tsx apps/api/scripts/homolog-simples.ts
```

O script emite dois cenários em **homologação** (`BASE` é hardcoded, não lê env — não há caminho para produção por acidente):

- **S1** — CSOSN 101 com repasse de crédito ← o caso real
- **S2** — CSOSN 102 sem crédito, controle para clientes não contribuintes

E valida o XML autorizado: `CRT=1`, grupo `ICMSSN`, `CSOSN`, `pCredSN`, `vCredICMSSN`, e ausência de `CST`/`vICMS` dentro do grupo do item.

Relatório sai em `docs/faturamento/homologacao-simples-nacional-<data>.md`.

## ⚠️ Antes de emitir em PRODUÇÃO

1. **Confirmar o `pCredSN` com o contador.** É a parcela de ICMS embutida na alíquota do DAS, e depende do anexo e da faixa de receita bruta. 1,44% é hipótese (Anexo II, 1ª faixa). **Errar gera crédito indevido para a CRD.**
2. Confirmar com o contador que a ST realmente não incide na operação (destino a industrialização).
3. O código está na main mas **não foi deployado** — ver #1061, cujo escopo mudou.
4. Rodar a migration `20260812150000_tax_rule_csosn_simples` via `db execute` idempotente (**nunca** `migrate deploy` enquanto #640 estiver aberto).

## Gaps conhecidos que não bloqueiam

- **#1080** — venda a prazo não leva os vencimentos (falta grupo `cobr`/`dup`). A SEFAZ aceita; o contas a pagar da CRD é que não recebe o cronograma pelo XML.
- **#1075** — devolução de emitente do Simples ainda sairia com CST (`ItemTax` não persiste CSOSN). O validador barra antes de transmitir.
- **#1082** — motor não calcula ST; concreto agora que sabemos que o produto está na lista.
