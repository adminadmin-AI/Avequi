# Homologação SEFAZ — Notas de Débito/Crédito IBS/CBS (finNFe 5/6)

**Data:** 17/07/2026 · **Épico:** #753 (onda F4, issues #759/#760) · **Ambiente:** homologação Focus/SEFAZ-PR (GDR) · **Runs:** 1784332636080 → 1784333924944 (4 rodadas completas + 1 teste isolado)

## Resultado

| Cenário | Instrumento | Status |
|---------|-------------|--------|
| G1 | **Nota de Débito** — multa e juros (tpNFDebito 04) | ✅ **AUTORIZADA** (XML validado: finNFe 6, tpNF 1, gDFeReferenciado por item, vCBS/vIBSUF exatos) |
| G2 | **Nota de Crédito** — redução de valores (tpNFCredito 04) | ✅ **AUTORIZADA** (XML validado: finNFe 5, tpNF 0, refNFe no cabeçalho, valores exatos) |
| G3 | Crédito — retorno por recusa (tpNFCredito 03) | ⚠️ **SENTINELA** — conflito de regras da SEFAZ (ver abaixo); caso real coberto pela devolução finNFe 4 |

Suíte completa: **17/20 cenários 100% OK** — os 3 restantes são fixtures conhecidas (B1/D1 rej. 234 IE fake de teste; C4 rej. 866 troco), inalteradas desde runs anteriores.

## Aprendizados da SEFAZ (iterados rodada a rodada, codificados no Fiscal Validator #499)

1. **Nota de Crédito é ENTRADA** (`tpNF 0`) — rej. 1161 com saída. Débito é saída (`tpNF 1`).
2. **Referenciamento é ASSIMÉTRICO**:
   - **Débito (saída)**: referência **POR ITEM** via `gDFeReferenciado` (`chave_acesso_dfe_referenciado` + `numero_item_dfe_referenciado` na Focus). Sem item → rej. 1038; cabeçalho junto → rej. 1010.
   - **Crédito (entrada)**: referência **no CABEÇALHO** (`notas_referenciadas`/`refNFe`), como a devolução. Sem cabeçalho → rej. 254.
3. **CFOP acompanha o sentido**: débito 5949/6949; crédito 1949/2949 — rej. 519 com CFOP de saída em nota de entrada.
4. **Conflito de regras da SEFAZ-PR** para `finNFe 5 + tpNFCredito 03/06` (retorno/recusa): CFOP genérico (1949) → rej. 327 "CFOP inválido para NF de devolução ou retorno"; CFOP de devolução (1201/1202) → rej. 328 "CFOP de devolução para NF-e que não é devolução". **Nenhum CFOP passa.** Mitigação: o ERP bloqueia os motivos 03/06 do crédito com orientação para a NF-e de devolução (finNFe 4 — autorizada e em produção); o cenário G3 do `audit-homologacao.ts` fica como sentinela `authorized: false` — quando autorizar, a SEFAZ corrigiu e podemos reabrir os motivos.

## Pendências fora do código

- **Contador**: confirmar quais motivos (tpNFDebito 01-08 / tpNFCredito 01-06) a GDR/CRD usará operacionalmente — bloqueia o uso em produção, não o código.
- Acompanhar NT da SEFAZ sobre o conflito 327↔328 (rotina #666 vigia as fontes oficiais).

O relatório bruto da rodada final segue abaixo.

---

# Auditoria de Homologação — Faturamento NF-e

**Data:** 2026-07-18T00:20:35.548Z · **Run:** 1784333924944 · **Ambiente:** homologação Focus/SEFAZ-PR

**Resultado:** 17/20 cenários 100% OK · 3 checks falhando

| # | Cenário | Status | SEFAZ | Checks |
|---|---------|--------|-------|--------|
| A1 | Venda interna PR→PR (PF, sem DIFAL) | autorizado | 100 | ✅ ✅ ✅ ✅ ✅ |
| A2 | PR→SP consumidor final (DIFAL 18% + FCP esperado 2%) | autorizado | 100 | ✅ ✅ ✅ ✅ |
| A3 | PR→MG consumidor final (DIFAL 18%) | autorizado | 100 | ✅ ✅ ✅ |
| A4 | PR→RS consumidor final (DIFAL 17%) | autorizado | 100 | ✅ ✅ ✅ |
| A5 | PR→RJ consumidor final (DIFAL 20% + FCP esperado 2%) | autorizado | 100 | ✅ ✅ ✅ ✅ |
| B1 | PJ contribuinte com IE (SC — sem DIFAL, indIEDest=1) | erro_autorizacao | 234 | ❌ |
| B2 | PJ sem IE (SC — indIEDest=2, sem DIFAL) | autorizado | 100 | ✅ ✅ ✅ |
| C1 | Multi-item: reboque + 3 acessórios (PR) | autorizado | 100 | ✅ ✅ ✅ |
| C2 | Item comum sem grupo veículo (PR) | autorizado | 100 | ✅ ✅ ✅ |
| C3 | Arredondamento: 3 × R$1.234,56 PR→SC (DIFAL) | autorizado | 100 | ✅ ✅ ✅ ✅ |
| C4 | Item com desconto R$500 + pagamento PIX (tPag 17) | erro_autorizacao | 866 | ❌ |
| D1 | Transferência entre estabelecimentos (6152) | erro_autorizacao | 234 | ❌ |
| D2 | Devolução de venda (entrada 1202, finalidade 4, ref A1) | autorizado | 100 | ✅ |
| E1 | cClassTrib 200003 (CST 200 — redução 100%) com gRed (#446) | autorizado | 100 | ✅ ✅ |
| E2 | Item com IBS/CBS + item sem (mix) | autorizado | 100 | ✅ ✅ |
| F1 | Cancelamento com verificação de retorno | cancelado | 135 | ✅ ✅ ✅ ✅ ✅ |
| F2 | Carta de correção (CC-e) | autorizado | — | ✅ ✅ |
| G1 | Nota de Débito — multa e juros (finNFe 6, tpNFDebito 04, ref A1) | autorizado | 100 | ✅ ✅ ✅ ✅ ✅ ✅ |
| G2 | Nota de Crédito — redução de valores (finNFe 5, tpNFCredito 04, ref A1) | autorizado | 100 | ✅ ✅ ✅ ✅ ✅ ✅ |
| G3 | SENTINELA — crédito retorno por recusa (finNFe 5 tp03: conflito SEFAZ 327↔328) | erro_autorizacao | 328 | ✅ |

## Detalhes por cenário

### A1 — Venda interna PR→PR (PF, sem DIFAL)
- ref: `GDR-AUD-1784333924944-A1` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010801294727974`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000101
- ✅ IBS/CBS valores — vCBS=405.00 vIBSUF=45.00 (esperado 405.00/45.00)
- ✅ sem ICMSUFDest
- ✅ total da nota (vNF) — vNF=45000.00 (esperado 45000.00)

### A2 — PR→SP consumidor final (DIFAL 18% + FCP esperado 2%)
- ref: `GDR-AUD-1784333924944-A2` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010811056913140`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000102
- ✅ DIFAL no XML — vICMSUFDest=2700.00 (esperado 2700.00)
- ✅ FCP UF destino (regra de negócio: 2%) — pFCPUFDest=2% (vFCPUFDest=900.00)

### A3 — PR→MG consumidor final (DIFAL 18%)
- ref: `GDR-AUD-1784333924944-A3` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010821132604952`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000103
- ✅ DIFAL no XML — vICMSUFDest=2280.00 (esperado 2280.00)

### A4 — PR→RS consumidor final (DIFAL 17%)
- ref: `GDR-AUD-1784333924944-A4` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010831628862744`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000104
- ✅ DIFAL no XML — vICMSUFDest=1375.00 (esperado 1375.00)

### A5 — PR→RJ consumidor final (DIFAL 20% + FCP esperado 2%)
- ref: `GDR-AUD-1784333924944-A5` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010841471413321`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000105
- ✅ DIFAL no XML — vICMSUFDest=4160.00 (esperado 4160.00)
- ✅ FCP UF destino (regra de negócio: 2%) — pFCPUFDest=2% (vFCPUFDest=1040.00)

### B1 — PJ contribuinte com IE (SC — sem DIFAL, indIEDest=1)
- ref: `GDR-AUD-1784333924944-B1` · status: **erro_autorizacao** (SEFAZ 234)
- msg: IE do destinatario nao vinculada ao CNPJ
- ❌ autorizada — 234 IE do destinatario nao vinculada ao CNPJ

### B2 — PJ sem IE (SC — indIEDest=2, sem DIFAL)
- ref: `GDR-AUD-1784333924944-B2` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010851306322444`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000107
- ✅ sem ICMSUFDest

### C1 — Multi-item: reboque + 3 acessórios (PR)
- ref: `GDR-AUD-1784333924944-C1` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010861199732781`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — chassi 9BGRD08X0XG000108
- ✅ total da nota (vNF) — vNF=12615.37 (esperado 12615.37)

### C2 — Item comum sem grupo veículo (PR)
- ref: `GDR-AUD-1784333924944-C2` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010871708000934`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ veicProd no XML — ausente
- ✅ total da nota (vNF) — vNF=450.00 (esperado 450.00)

### C3 — Arredondamento: 3 × R$1.234,56 PR→SC (DIFAL)
- ref: `GDR-AUD-1784333924944-C3` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010881933476476`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ IBS/CBS valores — vCBS=33.33 vIBSUF=3.70 (esperado 33.33/3.70)
- ✅ DIFAL no XML — vICMSUFDest=185.18 (esperado 185.18)
- ✅ total da nota (vNF) — vNF=3703.68 (esperado 3703.68)

### C4 — Item com desconto R$500 + pagamento PIX (tPag 17)
- ref: `GDR-AUD-1784333924944-C4` · status: **erro_autorizacao** (SEFAZ 866)
- msg: Ausencia de troco quando o valor dos pagamentos informados for maior que o total da nota
- ❌ autorizada — 866 Ausencia de troco quando o valor dos pagamentos informados for maior que o total da nota

### D1 — Transferência entre estabelecimentos (6152)
- ref: `GDR-AUD-1784333924944-D1` · status: **erro_autorizacao** (SEFAZ 234)
- msg: IE do destinatario nao vinculada ao CNPJ
- ❌ autorizada — 234 IE do destinatario nao vinculada ao CNPJ

### D2 — Devolução de venda (entrada 1202, finalidade 4, ref A1)
- ref: `GDR-AUD-1784333924944-D2` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010891221396710`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e

### E1 — cClassTrib 200003 (CST 200 — redução 100%) com gRed (#446)
- ref: `GDR-AUD-1784333924944-E1` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010901612236380`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ IBS/CBS valores — vCBS=0 vIBSUF=0 (esperado 0.00/0.00)

### E2 — Item com IBS/CBS + item sem (mix)
- ref: `GDR-AUD-1784333924944-E2` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010911718089078`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ total da nota (vNF) — vNF=20100.00 (esperado 20100.00)

### F1 — Cancelamento com verificação de retorno
- ref: `GDR-AUD-1784333924944-A3` · status: **cancelado** (SEFAZ 135) · chave `NFe41260746247069000115550010000010821132604952`
- msg: Evento registrado e vinculado a NF-e
- ✅ DELETE aceito — HTTP 200 cancelado
- ✅ status → cancelado (mapeia p/ CANCELLED no webhook) — status=cancelado
- ✅ XML de cancelamento disponível — /arquivos_development/46247069000115_231393/202607/XMLs/41260746247069000115550010000010821132604952-can.xml
- ✅ campos p/ applyFocusResponse presentes (chave/numero/serie) — numero=1082 serie=1
- ✅ protocolo de cancelamento (nProt) no XML — 141260000437576

### F2 — Carta de correção (CC-e)
- ref: `GDR-AUD-1784333924944-A4` · status: **autorizado** 
- msg: Evento registrado e vinculado a NF-e
- ✅ CC-e aceita — HTTP 200 autorizado
- ✅ XML da CC-e disponível — /arquivos_development/46247069000115_231393/202607/XMLs/41260746247069000115550010000010831628862744-cce-01.xml

### G1 — Nota de Débito — multa e juros (finNFe 6, tpNFDebito 04, ref A1)
- ref: `GDR-AUD-1784333924944-G1` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010921027608605`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ IBS/CBS valores — vCBS=3.15 vIBSUF=0.35 (esperado 3.15/0.35)
- ✅ XML <finNFe>=6 — <finNFe>=6
- ✅ XML <tpNFDebito>=04 — <tpNFDebito>=04
- ✅ XML <tpNF>=1 — <tpNF>=1
- ✅ XML <chaveAcesso>=41260746247069000115550010000010801294727974 — <chaveAcesso>=41260746247069000115550010000010801294727974

### G2 — Nota de Crédito — redução de valores (finNFe 5, tpNFCredito 04, ref A1)
- ref: `GDR-AUD-1784333924944-G2` · status: **autorizado** (SEFAZ 100) · chave `NFe41260746247069000115550010000010931844867739`
- msg: Autorizado o uso da NF-e
- ✅ autorizada — 100 Autorizado o uso da NF-e
- ✅ IBS/CBS valores — vCBS=9.00 vIBSUF=1.00 (esperado 9.00/1.00)
- ✅ XML <finNFe>=5 — <finNFe>=5
- ✅ XML <tpNFCredito>=04 — <tpNFCredito>=04
- ✅ XML <tpNF>=0 — <tpNF>=0
- ✅ XML <refNFe>=41260746247069000115550010000010801294727974 — <refNFe>=41260746247069000115550010000010801294727974

### G3 — SENTINELA — crédito retorno por recusa (finNFe 5 tp03: conflito SEFAZ 327↔328)
- ref: `GDR-AUD-1784333924944-G3` · status: **erro_autorizacao** (SEFAZ 328)
- msg: CFOP de devolucao de mercadoria para NF-e que nao e de devolucao ou de retorno de mercadoria. [nItem:1]
- ✅ rejeição esperada — 328 CFOP de devolucao de mercadoria para NF-e que nao e de devolucao ou de retorno de mercadoria. [nItem:1]

## ⚠️ Achados (checks falhando)

- **[B1] PJ contribuinte com IE (SC — sem DIFAL, indIEDest=1)** → autorizada — 234 IE do destinatario nao vinculada ao CNPJ
- **[C4] Item com desconto R$500 + pagamento PIX (tPag 17)** → autorizada — 866 Ausencia de troco quando o valor dos pagamentos informados for maior que o total da nota
- **[D1] Transferência entre estabelecimentos (6152)** → autorizada — 234 IE do destinatario nao vinculada ao CNPJ