# Faturamento — Gap Analysis

> Análise realizada em 30/06/2026 com base no estudo fiscal do Fluxo 1
> (Venda para Revenda) e na estrutura atual do Avequi.

## Resumo Executivo

O Avequi já possui **infraestrutura sólida** de integração com Focus NFe (emissão, cancelamento,
CC-e, webhook, retry). O motor tributário e o fluxo OV→NF-e também existem. Os gaps são
**específicos para operação de veículos** (grupo veículo na NF-e, dados técnicos do reboque)
e **controle pós-venda** (BIN, ATPV-e, expedição).

---

## O que existe ✅

### Módulo Fiscal (`modules/fiscal/`)
- `FiscalClientService` — HTTP client Focus NFe com todos os métodos (emit, cancel, CCe, void, status, webhook)
- `FiscalMapper` — builder de payload NF-e/NFC-e (emitente, destinatário, itens, tributos)
- `FiscalService` — orquestração (idempotência, retry em REJECTED/ERROR, janela 24h cancelamento)
- `FiscalListener` — event-driven: `SALE_INVOICED_EVENT` → `emitForSale()`
- Webhook endpoint para receber status assíncrono do Focus

### Módulo Tax (`modules/tax/`)
- `TaxRule` — regras por company, operationType, NCM, productType, UF origem/destino
- `TaxCalculationService` — seleção por prioridade, cálculo ICMS/IPI/PIS/COFINS
- 13 tipos de operação (VENDA_INTERNA, VENDA_INTERESTADUAL, DEVOLUCAO, TRANSFERENCIA, etc.)

### Schema Fiscal (Prisma)
- `FiscalDocument` — type, status, focusRef, chave, xml, rejection
- `FiscalDocumentItem` — NCM, CFOP, CEST, valores
- `FiscalDocumentItemTax` — ICMS/IPI/PIS/COFINS por item (CST, base, alíquota, valor)
- `FiscalCorrection` — CC-e com sequência e protocolo
- `FiscalVoidRange` — inutilização com série, faixa, protocolo

### Fluxo de Vendas (`modules/sales/`)
- `SalesOrder` lifecycle: DRAFT → RESERVED → AWAITING_PICKING → READY_TO_INVOICE → INVOICED
- Picking obrigatório antes de faturar
- `Quotation` → `SalesOrder` conversion

### Serial Number
- `SerialNumber` com status (IN_PRODUCTION, IN_STOCK, SOLD, TRANSFERRED, SCRAPPED)
- Vinculado a `SaleItem` via `serialNumberId`
- `SerialComponent` para rastreio de BOM por serial

### Financeiro
- `FinancialEntry` (receivables/payables) criado automaticamente ao faturar
- Vinculado ao `FiscalDocument`
- CNAB/OFX reconciliation

### NF-e de Entrada
- `InboundNfe` com 3-way match (PO + GR + NF-e)
- `NfeManifest` para eventos de destinatário

---

## O que falta ❌

### P0 — Bloqueiam emissão de NF-e

#### GAP 1: Campos de veículo no SerialNumber (#357)
**Problema:** `SerialNumber` só tem `serial` (chassis). Faltam todos os campos técnicos do veículo.
**Campos necessários:** cor (código + descrição), peso líquido/bruto, qtd eixos, ano fab/modelo,
tipo veículo, espécie, condição, lotação, restrição, código marca/modelo RENAVAM, cor DENATRAN.
**Impacto:** Sem esses dados, é impossível montar o grupo veículo na NF-e.

#### GAP 2: Grupo veículo no FiscalMapper (#358)
**Problema:** `buildNFePayload()` não monta o bloco `veiculos_novos`.
**Impacto:** SEFAZ rejeita NF-e de NCM capítulo 87 sem grupo veículo.
**Dependência:** GAP 1 (campos no SerialNumber).

#### GAP 3: Endereço completo do destinatário (#359)
**Problema:** `FiscalMapper` envia apenas `name`, `cpf_cnpj`, `uf`. Focus exige endereço completo.
**Campos necessários:** logradouro, número, bairro, município, CEP, código IBGE, IE.
**Impacto:** NF-e interestadual rejeitada (rejeição SEFAZ 704/705).
**Nota:** `Customer.address` é string única (não normalizado), falta `codigoMunicipio` (IBGE).

#### GAP 4: Regras tributárias NCM 8716.39.00 (#360)
**Problema:** `TaxRule` não tem seed para reboques. Fallback usa CST 99 e IPI genérico (incorreto).
**Impacto:** Tributos calculados errados na NF-e.
**Regras corretas:** ICMS CST 000 sem ST, IPI CST 51 alíquota 0%, por par de UF.

### P1 — Controle operacional

#### GAP 5: Número/série/protocolo no FiscalDocument (#361)
**Problema:** Campos `number`, `series`, `protocolNumber` não existem no schema.
**Impacto:** Dados ficam enterrados no XML; impossível consultar por numeração.

#### GAP 6: Rastreamento BIN (#362)
**Problema:** Nenhuma entidade para tracking de pré-cadastro BIN (SENATRAN/SERPRO).
**Impacto:** Sem controle de qual chassis está registrado na BIN (pré-requisito para ATPV-e).

#### GAP 7: Rastreamento ATPV-e (#363)
**Problema:** Nenhuma entidade para tracking de ATPV-e.
**Impacto:** Sem visibilidade de quais vendas completaram o ciclo até emplacamento.

### P2 — Fluxo completo

#### GAP 8: Documentos CAT/CCT (#364)
**Problema:** Sem entidade para documentos regulatórios.
**Impacto:** Sem rastreamento de entrega de CAT/CCT por venda.

#### GAP 9: Entrega/Expedição (#365)
**Problema:** Sem entidade para fluxo pós-NF-e.
**Impacto:** Sem visibilidade do status de entrega física após faturamento.

#### GAP 10: IBS/CBS (#366)
**Problema:** Nenhum campo IBS/CBS no TaxRule, FiscalDocumentItemTax ou FiscalMapper.
**Impacto:** NF-e em 2026 deveria conter grupos IBS/CBS (regime duplo).
**Nota:** Depende do Focus NFe ativar suporte no payload.

---

## Consistência de Dados — Regra Fundamental

O Fluxo 1 exige que **quatro documentos** tenham dados idênticos:

```
NF-e da GDR ←──→ Registro BIN ←──→ NF-e da Revenda ←──→ ATPV-e
```

Campos que devem ser idênticos:
- Chassis (VIN)
- Cor (código + descrição)
- Peso Bruto Total (PBT)
- Número de eixos
- Tipo de veículo
- Dados do fabricante (razão social GDR)

**Qualquer divergência** — mesmo maiúsculas vs. minúsculas na cor — gera bloqueio no RENAVE
e impede emplacamento. O Avequi deve ser a **fonte única de verdade** desses dados,
garantindo que o payload da NF-e seja montado a partir dos mesmos campos usados no BIN.
