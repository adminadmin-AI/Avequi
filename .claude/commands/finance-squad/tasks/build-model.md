---
task: buildModel()
responsavel: "@model-builder"
responsavel_type: Agent
atomic_layer: Task
elicit: true
---

# Task: Build Financial Model

**Command:** `*build-model`
**Agent:** Model Builder
**Purpose:** Projetar estrutura completa de modelo financeiro — 3-statement, DCF, LBO ou operacional.

## Inputs

| Field | Required |
|-------|----------|
| company | Sim — nome e descrição do negócio |
| model_type | Sim — 3-statement / DCF / LBO / operating / startup |
| revenue_model | Sim — como a empresa ganha dinheiro (SaaS, marketplace, serviços, etc.) |
| historical_data | Não — dados históricos disponíveis |
| purpose | Não — fundraise, valuation, gestão interna, M&A |
| market | Não — BR (BRL) ou US (USD) |

## Output Format

```
## Financial Model: [Company] — [Type]

### Model Architecture
**Tabs necessárias:**
1. Assumptions (central de inputs)
2. Revenue Model (drivers → receita)
3. P&L (DRE)
4. Balance Sheet (Balanço)
5. Cash Flow (DFC)
6. [DCF / Debt Schedule / Returns — conforme tipo]
7. Output Dashboard

### Assumptions Tab — Inputs Principais
| Driver | Base Case | Bear | Bull | Fonte |
|--------|-----------|------|------|-------|
| [Driver 1] | | | | |
| [Driver 2] | | | | |

### Revenue Model
[Estrutura driver-based específica para o modelo de negócio]

### P&L Projetado (5 anos)
| | Ano 1 | Ano 2 | Ano 3 | Ano 4 | Ano 5 |
|-|-------|-------|-------|-------|-------|
| Receita | | | | | |
| Gross Profit | | | | | |
| EBITDA | | | | | |
| Lucro Líquido | | | | | |

### Checks de Integridade
- [ ] Balanço fecha (Ativo = Passivo + PL)
- [ ] DFC reconcilia com Balanço
- [ ] Assumptions tab tem todos os inputs centralizados
- [ ] Sensitivity table construída nos eixos principais

### Próximos Passos para Construção
1. [Passo 1 — o que fazer primeiro no Excel/Sheets]
2. [Passo 2]
3. [Passo 3]
```
