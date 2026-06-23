---
task: financialHealthCheck()
responsavel: "@finance-chief"
responsavel_type: Agent
atomic_layer: Orchestration
elicit: true
---

# Task: Financial Health Check

**Command:** `*financial-health-check`
**Orchestration:** Finance Chief → 5 especialistas em sequência
**Purpose:** Diagnóstico financeiro completo de uma empresa. Equivale a contratar um time de consultores por 1 semana.

## Inputs

| Field | Required |
|-------|----------|
| company | Sim — nome e descrição |
| stage | Sim — estágio da empresa |
| revenue | Sim — receita atual |
| key_metrics | Sim — principais métricas disponíveis |
| market | Não — BR (default) ou US |
| purpose | Não — o que vai fazer com este diagnóstico |

---

## Orchestration Flow

```
Finance Chief (diagnóstico e roteamento)
    │
    ├── 1. Brazil Market 🇧🇷 (se BR)
    │   └── Calibra WACC, instrumentos, regime tributário
    │
    ├── 2. CFO Architect 📈
    │   └── Saúde operacional: burn, runway, unit economics, KPIs
    │
    ├── 3. Damodaran 📊
    │   └── Valuation atual: DCF indicativo + múltiplos de mercado
    │
    ├── 4. Capital Architect 🏗️
    │   └── Estrutura de capital: alavancagem, custo de capital, próximo passo de funding
    │
    └── 5. Finance Chief (síntese)
        └── Diagnóstico integrado + top 3 prioridades
```

---

## Output Format

```
# Financial Health Check — [Company]
Data: [hoje] | Estágio: [X] | Mercado: [BR/US]

---

## 1. CONTEXTO DE MERCADO
[Brazil Market — se aplicável]
- WACC calibrado: X%
- Regime tributário atual / recomendado: X
- Instrumentos de dívida disponíveis: [lista]
- Benchmark de valuation no ecossistema: R$X–X

---

## 2. SAÚDE OPERACIONAL
[CFO Architect]

### Liquidez
- Caixa: R$X | Burn: R$X/mês | Runway: X meses
- Burn Multiple: Xx — [Excelente/Bom/Preocupante/Crítico]

### Unit Economics
- CAC: R$X | LTV: R$X | LTV/CAC: Xx | Payback: X meses
- Status: [✅ Saudável / ⚠️ Atenção / ❌ Quebrado]

### KPIs Críticos
| KPI | Atual | Benchmark | Status |
|-----|-------|-----------|--------|
| | | | |

---

## 3. VALUATION INDICATIVA
[Damodaran]

- **Valuation range:** R$X – R$X
- **Múltiplo implícito:** Xx ARR / Xx EBITDA
- **Metodologia:** [DCF / Revenue multiple / comps BR]
- **Drivers de valor:** [top 3]
- **O que mais move a valuation:** [1 fator]

---

## 4. ESTRUTURA DE CAPITAL
[Capital Architect]

- **Dívida atual:** R$X (Xx EBITDA)
- **WACC atual:** X%
- **Capacidade de dívida adicional:** R$X (limite seguro)
- **Instrumento recomendado para próximo capital:** [equity/dívida/híbrido]
- **Custo de capital por opção:**
  - Equity (dilution): X%
  - Dívida (CDI+spread): X%
  - BNDES (se elegível): X%

---

## 5. DIAGNÓSTICO INTEGRADO
[Finance Chief]

### Semáforo Financeiro
| Dimensão | Status | Nota |
|----------|--------|------|
| Liquidez | 🟢/🟡/🔴 | |
| Unit Economics | 🟢/🟡/🔴 | |
| Crescimento | 🟢/🟡/🔴 | |
| Estrutura de Capital | 🟢/🟡/🔴 | |
| Valuation | 🟢/🟡/🔴 | |

### Top 3 Prioridades (ordenadas por impacto)
1. **[Prioridade 1]** — [o que fazer, prazo, quem]
2. **[Prioridade 2]** — [o que fazer, prazo, quem]
3. **[Prioridade 3]** — [o que fazer, prazo, quem]

### Próxima Decisão Financeira Crítica
**Decisão:** [qual é]
**Prazo:** [quando precisa ser tomada]
**Task recomendada:** [qual task do finance-squad usar]
```
