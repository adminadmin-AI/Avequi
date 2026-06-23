---
task: burnRunway()
responsavel: "@cfo-architect"
responsavel_type: Agent
atomic_layer: Task
elicit: true
---

# Task: Burn Rate & Runway Analysis

**Command:** `*burn-runway`
**Agent:** CFO Architect
**Purpose:** Calcular burn rate, runway, burn multiple e recomendar ações concretas.

## Inputs

| Field | Required |
|-------|----------|
| cash_balance | Sim — saldo de caixa atual |
| gross_burn | Sim — total gasto por mês |
| revenue | Sim — receita mensal atual |
| revenue_growth | Não — crescimento mensal esperado |
| headcount_plan | Não — contratações previstas |
| market | Não — BR (usa CDI/BRL) ou US |

## Output Format

```
## Burn & Runway Analysis

### Situação Atual
- **Gross Burn:** R$X/mês
- **Net Burn:** R$X/mês (Gross - Receita)
- **Caixa:** R$X
- **Runway (base):** X meses
- **Runway (conservador -20% receita):** X meses

### Burn Multiple
- **Fórmula:** Net Burn / New ARR adicionado
- **Resultado:** Xx
- **Benchmark:** <1x excelente | 1-1.5x bom | >2x preocupante

### Projeção de Caixa (12 meses)
| Mês | Receita | Burn | Caixa |
|-----|---------|------|-------|
| ... | | | |

### Alertas
- [ ] Runway < 12 meses — acionar fundraise ou corte de custos
- [ ] Burn multiple > 2x — crescimento caro demais
- [ ] Receita < 50% do plano — revisar forecast

### Recomendações
1. [Ação prioritária]
2. [Ação secundária]

### Decisão de Fundraise
**Iniciar processo quando:** X meses de runway restante
**Target close:** [data]
**Bridge necessário:** R$X (se runway < 6 meses)
```
