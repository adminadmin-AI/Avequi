# Finance Squad

> **Corporate Finance Intelligence** — Valuation, FP&A, Capital Structure, M&A, Financial Modeling e Mercado Brasileiro.

---

## Agents (7)

| Agente | Domínio | Quando usar |
|--------|---------|-------------|
| **Finance Chief** 💼 | Orchestrador | Start here — diagnostica e roteia |
| **Damodaran** 📊 | Valuation | DCF, comps, startup valuation |
| **CFO Architect** 📈 | FP&A & Ops | Budgets, forecasts, burn/runway, unit economics |
| **Capital Architect** 🏗️ | Capital Structure | WACC, dívida vs equity, fundraising |
| **Deal Maker** 🤝 | M&A | Due diligence, sinergias, estrutura de deal |
| **Model Builder** 🔢 | Financial Modeling | 3-statement, DCF, LBO, cenários |
| **Brazil Market** 🇧🇷 | Mercado BR | SELIC/CDI, JSCP, CADE, debentures, ecossistema BR |

---

## Tasks (8)

| Task | Agentes | Propósito |
|------|---------|-----------|
| `*financial-health-check` | **Todos (orquestrado)** | Diagnóstico financeiro completo da empresa |
| `*diagnose` | Finance Chief | Triagem rápida → roteamento |
| `*value-company` | Damodaran | Valuation DCF + comps com sensibilidade |
| `*plan-fundraise` | Capital Architect + Brazil Market + Damodaran | Estratégia completa de captação |
| `*burn-runway` | CFO Architect | Burn rate, runway, burn multiple, projeção |
| `*build-model` | Model Builder | Estrutura de modelo financeiro (3-statement, DCF, LBO) |
| `*analyze-deal` | Deal Maker | M&A: rationale, sinergias, estrutura, go/no-go |
| `*review` | Finance Chief | Quality check de qualquer entregável financeiro |

---

## Como usar

**Diagnóstico completo (melhor ponto de entrada):**
```
/finance-squad/tasks/financial-health-check
Company: Veluo (SaaS fintech multi-tenant)
Stage: Early — $2M ARR
Revenue: R$10M ARR
Key metrics: MRR R$833K, crescimento 15% MoM, burn R$400K/mês, caixa R$2.4M
Market: BR
Purpose: Decidir se levantamos Série A agora ou em 6 meses
```

**Fundraise específico:**
```
/finance-squad/tasks/plan-fundraise
Company: Aevo
Stage: seed
Amount: R$3M
Market: BR
```

**Agente direto:**
```
/finance-squad/agents/damodaran
Valor de SaaS BR: R$10M ARR, 150% NDR, crescendo 80% YoY, ainda burn
```

---

## Framework Map

```
Problema Financeiro
├── Diagnóstico geral?         → financial-health-check (todos os agentes)
├── Quanto vale?               → value-company (Damodaran)
├── Burn / runway?             → burn-runway (CFO Architect)
├── Levantar capital?          → plan-fundraise (Capital + BrazilMkt + Damodaran)
├── Fazer uma aquisição?       → analyze-deal (Deal Maker)
├── Construir modelo?          → build-model (Model Builder)
├── Empresa brasileira?        → brazil-market (calibração obrigatória)
└── Não sabe por onde começar? → diagnose (Finance Chief)
```

---

## Referências

- `references/brazil-market.md` — SELIC, CDI, JSCP, CADE, debentures, ecossistema BR
- `checklists/output-quality.md` — 7 dimensões de qualidade para todo entregável
