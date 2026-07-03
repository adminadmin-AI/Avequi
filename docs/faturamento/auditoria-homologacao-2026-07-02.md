# Auditoria de Homologação — Faturamento NF-e

**Data:** 2026-07-03T00:29:07.708Z · **Run:** 1783038493431 · **Ambiente:** homologação Focus/SEFAZ-PR

**Resultado:** 12/17 cenários 100% OK · 5 checks falhando

| # | Cenário | Status | SEFAZ | Checks |
|---|---------|--------|-------|--------|
| A1 | Venda interna PR→PR (PF, sem DIFAL) | autorizado | 100 | ✅ ✅ ✅ ✅ ✅ |
| A2 | PR→SP consumidor final (DIFAL 18% + FCP esperado 2%) | autorizado | 100 | ✅ ✅ ✅ ❌ |
| A3 | PR→MG consumidor final (DIFAL 18%) | autorizado | 100 | ✅ ✅ ✅ |
| A4 | PR→RS consumidor final (DIFAL 17%) | autorizado | 100 | ✅ ✅ ✅ |
| A5 | PR→RJ consumidor final (DIFAL 20% + FCP esperado 2%) | autorizado | 100 | ✅ ✅ ✅ ❌ |
| B1 | PJ contribuinte com IE (SC — sem DIFAL, indIEDest=1) | erro_autorizacao | 234 | ❌ |
| B2 | PJ sem IE (SC — indIEDest=2, sem DIFAL) | autorizado | 100 | ✅ ✅ ✅ |
| C1 | Multi-item: reboque + 3 acessórios (PR) | autorizado | 100 | ✅ ✅ ✅ |
| C2 | Item comum sem grupo veículo (PR) | autorizado | 100 | ✅ ✅ ✅ |
| C3 | Arredondamento: 3 × R$1.234,56 PR→SC (DIFAL) | autorizado | 100 | ✅ ✅ ✅ ✅ |
| C4 | Item com desconto R$500 (PR) | autorizado | 100 | ✅ ✅ |
| D1 | Transferência entre estabelecimentos (6152) | erro_autorizacao | 234 | ❌ |
| D2 | Devolução de venda (entrada 1202, finalidade 4, ref A1) | autorizado | 100 | ✅ |
| E1 | cClassTrib 200003 (CST 200 — redução) sem gRed: mapper suporta? | erro_autorizacao | 1033 | ❌ |
| E2 | Item com IBS/CBS + item sem (mix) | autorizado | 100 | ✅ ✅ |
| F1 | Cancelamento com verificação de retorno | cancelado | 135 | ✅ ✅ ✅ ✅ ✅ |
| F2 | Carta de correção (CC-e) | autorizado | — | ✅ ✅ |

## Detalhes por cenário

### A1 — Venda interna PR→PR (PF, sem DIFAL)
- ref: `GDR-AUD-1783038493431-A1` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000151103780090`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000101
- ✅ IBS/CBS valores — vCBS=405.00 vIBSUF=45.00 (esperado 405.00/45.00)
- ✅ sem ICMSUFDest
- ✅ total da nota (vNF) — vNF=45000.00 (esperado 45000.00)

### A2 — PR→SP consumidor final (DIFAL 18% + FCP esperado 2%)
- ref: `GDR-AUD-1783038493431-A2` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000161493223288`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000102
- ✅ DIFAL no XML — vICMSUFDest=2700.00 (esperado 2700.00)
- ❌ FCP UF destino (regra de negócio: 2%) — XML envia pFCPUFDest=0% — NF-e real #14236 usa 2% p/ SP

### A3 — PR→MG consumidor final (DIFAL 18%)
- ref: `GDR-AUD-1783038493431-A3` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000171203716631`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000103
- ✅ DIFAL no XML — vICMSUFDest=2280.00 (esperado 2280.00)

### A4 — PR→RS consumidor final (DIFAL 17%)
- ref: `GDR-AUD-1783038493431-A4` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000181396991815`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000104
- ✅ DIFAL no XML — vICMSUFDest=1375.00 (esperado 1375.00)

### A5 — PR→RJ consumidor final (DIFAL 20% + FCP esperado 2%)
- ref: `GDR-AUD-1783038493431-A5` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000191412020057`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000105
- ✅ DIFAL no XML — vICMSUFDest=4160.00 (esperado 4160.00)
- ❌ FCP UF destino (regra de negócio: 2%) — XML envia pFCPUFDest=0% — NF-e real #14236 usa 2% p/ SP

### B1 — PJ contribuinte com IE (SC — sem DIFAL, indIEDest=1)
- ref: `GDR-AUD-1783038493431-B1` · status: **erro_autorizacao** (SEFAZ 234)
- msg: IE do destinatario nao vinculada ao CNPJ
- ❌ autorizada — 234 IE do destinatario nao vinculada ao CNPJ

### B2 — PJ sem IE (SC — indIEDest=2, sem DIFAL)
- ref: `GDR-AUD-1783038493431-B2` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000201926143857`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000107
- ✅ sem ICMSUFDest

### C1 — Multi-item: reboque + 3 acessórios (PR)
- ref: `GDR-AUD-1783038493431-C1` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000211772953541`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000108
- ✅ total da nota (vNF) — vNF=12615.37 (esperado 12615.37)

### C2 — Item comum sem grupo veículo (PR)
- ref: `GDR-AUD-1783038493431-C2` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000221420250789`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — ausente
- ✅ total da nota (vNF) — vNF=450.00 (esperado 450.00)

### C3 — Arredondamento: 3 × R$1.234,56 PR→SC (DIFAL)
- ref: `GDR-AUD-1783038493431-C3` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000231418956677`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ IBS/CBS valores — vCBS=33.33 vIBSUF=3.70 (esperado 33.33/3.70)
- ✅ DIFAL no XML — vICMSUFDest=185.18 (esperado 185.18)
- ✅ total da nota (vNF) — vNF=3703.68 (esperado 3703.68)

### C4 — Item com desconto R$500 (PR)
- ref: `GDR-AUD-1783038493431-C4` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000241646110117`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ total da nota (vNF) — vNF=44500.00 (esperado 44500.00)

### D1 — Transferência entre estabelecimentos (6152)
- ref: `GDR-AUD-1783038493431-D1` · status: **erro_autorizacao** (SEFAZ 234)
- msg: IE do destinatario nao vinculada ao CNPJ
- ❌ autorizada — 234 IE do destinatario nao vinculada ao CNPJ

### D2 — Devolução de venda (entrada 1202, finalidade 4, ref A1)
- ref: `GDR-AUD-1783038493431-D2` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000251121972318`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e

### E1 — cClassTrib 200003 (CST 200 — redução) sem gRed: mapper suporta?
- ref: `GDR-AUD-1783038493431-E1` · status: **erro_autorizacao** (SEFAZ 1033)
- msg: CST do IBS/CBS informado ou compras governamentais obriga informacao de reducao de aliquota estadual. [nItem:1]
- ❌ autorizada — 1033 CST do IBS/CBS informado ou compras governamentais obriga informacao de reducao de aliquota estadual. [nItem:1]

### E2 — Item com IBS/CBS + item sem (mix)
- ref: `GDR-AUD-1783038493431-E2` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000000261232260712`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ total da nota (vNF) — vNF=20100.00 (esperado 20100.00)

### F1 — Cancelamento com verificação de retorno
- ref: `GDR-AUD-1783038493431-A3` · status: **cancelado** (SEFAZ 135) · chave `NFe41260746247069000115550010000000171203716631`
- msg: Evento registrado e vinculado a NF-e
- ✅ DELETE aceito — HTTP 200 cancelado
- ✅ status → cancelado (mapeia p/ CANCELLED no webhook) — status=cancelado
- ✅ XML de cancelamento disponível — /arquivos_development/46247069000115_227102/202607/XMLs/41260746247069000115550010000000171203716631-can.xml
- ✅ campos p/ applyFocusResponse presentes (chave/numero/serie) — numero=17 serie=1
- ✅ protocolo de cancelamento (nProt) no XML — 141260000402038

### F2 — Carta de correção (CC-e)
- ref: `GDR-AUD-1783038493431-A4` · status: **autorizado** 
- msg: Evento registrado e vinculado a NF-e
- ✅ CC-e aceita — HTTP 200 autorizado
- ✅ XML da CC-e disponível — /arquivos_development/46247069000115_227102/202607/XMLs/41260746247069000115550010000000181396991815-cce-01.xml

## ⚠️ Achados (checks falhando)

- **[A2] PR→SP consumidor final (DIFAL 18% + FCP esperado 2%)** → FCP UF destino (regra de negócio: 2%) — XML envia pFCPUFDest=0% — NF-e real #14236 usa 2% p/ SP
- **[A5] PR→RJ consumidor final (DIFAL 20% + FCP esperado 2%)** → FCP UF destino (regra de negócio: 2%) — XML envia pFCPUFDest=0% — NF-e real #14236 usa 2% p/ SP
- **[B1] PJ contribuinte com IE (SC — sem DIFAL, indIEDest=1)** → autorizada — 234 IE do destinatario nao vinculada ao CNPJ
- **[D1] Transferência entre estabelecimentos (6152)** → autorizada — 234 IE do destinatario nao vinculada ao CNPJ
- **[E1] cClassTrib 200003 (CST 200 — redução) sem gRed: mapper suporta?** → autorizada — 1033 CST do IBS/CBS informado ou compras governamentais obriga informacao de reducao de aliquota estadual. [nItem:1]