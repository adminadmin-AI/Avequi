# Faturamento — Roadmap de Implementação

## Visão Geral

O Avequi atua como **portal de faturamento** que integra com o **Focus NFe** para emissão de NF-e.
O Avequi **não é o emissor direto** — ele monta o payload, envia ao Focus, e armazena todos os dados
de emissão e retorno para controle operacional e fiscal.

### Operação: Fluxo 1 — Venda para Revenda (Parceiro)

```
GDR (Indústria) ──NF-e──> Revenda (CNPJ) ──NF-e──> Cliente Final (CPF) ──> DETRAN (emplacamento)
       │                        │                         │
       ├── Pré-cadastro BIN     ├── Emissão ATPV-e        ├── Emplacamento
       ├── Emissão NF-e         ├── Entrega docs           └── CRLV
       └── Fornece CAT/CCT      └── NF-e ao CPF
```

**Produto:** Reboques de carga seca — NCM 8716.39.00
**Regime tributário:** Sem ICMS-ST em nenhum estado (PR, SC, RS, SP, MG)
**IPI:** Alíquota zero (CST 51) — mantém crédito dos insumos
**Referência fiscal completa:** `docs/faturamento/ESTUDO-FISCAL-FLUXO1.md`

---

## Status Atual — O que já existe

| Área | Status | Localização |
|------|--------|-------------|
| Cliente Focus NFe (emit/cancel/CCe/webhook) | ✅ Existe | `modules/fiscal/fiscal-client.service.ts` |
| Builder payload NF-e (emitente, itens, tributos) | ✅ Existe | `modules/fiscal/fiscal-mapper.ts` |
| Motor tributário (ICMS/IPI/PIS/COFINS por regra) | ✅ Existe | `modules/tax/` |
| Fluxo OV → picking → faturamento → NF-e | ✅ Existe | `modules/sales/` + `modules/fiscal/` |
| FiscalDocument + itens + impostos | ✅ Existe | Prisma schema |
| CC-e, inutilização, retry | ✅ Existe | `fiscal.service.ts` |
| Serial/chassis tracking básico | ⚠️ Parcial | `SerialNumber` (só campo `serial`) |
| Orçamento → OV | ✅ Existe | `modules/quotation/` |
| Contas a receber vinculadas a NF-e | ✅ Existe | `modules/financial/` |
| NF-e de entrada + manifestação | ✅ Existe | `modules/inbound-nfe/` |

---

## Roadmap — Issues no GitHub Project #7

### P0 — Bloqueiam emissão de NF-e (🔴 Crítico)

Sem esses itens, **não é possível emitir NF-e** de reboques.

| Issue | Título | Dependência |
|-------|--------|-------------|
| #367 | **[FAT P0.0] Setup Focus NFe** — conta, certificado A1, primeiro teste | Nenhuma |
| #357 | **[FAT P0.1] Schema — Campos de veículo** no SerialNumber | Nenhuma |
| #358 | **[FAT P0.2] FiscalMapper — Grupo veículo** no payload NF-e | #357 |
| #359 | **[FAT P0.3] FiscalMapper — Endereço completo** do destinatário | Nenhuma |
| #360 | **[FAT P0.4] TaxRule — Seed regras tributárias** NCM 8716.39.00 | Nenhuma |

**Ordem de execução:**
```
#367 (setup Focus)  ─────────────────────────────┐
#357 (campos veículo) → #358 (grupo veículo NF-e) ├──> Teste integrado homologação
#359 (endereço destinatário)  ────────────────────┤
#360 (tax rules seed)  ──────────────────────────┘
```

### P1 — Controle operacional (🟠 Alta)

Controle pós-emissão e rastreamento de documentos regulatórios.

| Issue | Título |
|-------|--------|
| #361 | **[FAT P1.1] FiscalDocument** — número, série e protocolo SEFAZ |
| #362 | **[FAT P1.2] BIN Registration** — rastreamento pré-cadastro SENATRAN |
| #363 | **[FAT P1.3] ATPV-e** — rastreamento do atestado de transferência |

### P2 — Fluxo completo (🟡 Média)

Complementos para operação completa e reforma tributária.

| Issue | Título |
|-------|--------|
| #364 | **[FAT P2.1] Documentos CAT/CCT/Projeto Técnico** |
| #365 | **[FAT P2.2] Entrega/Expedição** — entidade pós-NF-e |
| #366 | **[FAT P2.3] IBS/CBS** — Reforma Tributária 2026 |

---

## Critério de "Pronto para Faturar"

Para emitir a **primeira NF-e real** de um reboque GDR, todos os P0 devem estar concluídos:

- [ ] Conta Focus NFe ativa com certificado A1
- [ ] Token de produção configurado no Avequi
- [ ] Webhook do Focus apontando para API do Avequi
- [ ] Grupo veículo montado no payload (campos do SerialNumber preenchidos)
- [ ] Endereço completo do destinatário (Customer normalizado)
- [ ] Regras tributárias carregadas (NCM 8716.39.00, sem ST, IPI zero)
- [ ] NF-e de teste autorizada em homologação com grupo veículo
- [ ] Cancelamento e CC-e testados em homologação
