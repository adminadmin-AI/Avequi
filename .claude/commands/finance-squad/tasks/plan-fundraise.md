---
task: planFundraise()
responsavel: "@capital-architect"
responsavel_type: Agent
atomic_layer: Task
elicit: true
---

# Task: Plan Fundraise

**Command:** `*plan-fundraise`
**Agents:** Capital Architect + Brazil Market (se BR) + Damodaran (valuation)
**Purpose:** Estruturar estratégia completa de captação — instrumento, valor, valuation, investidores, timeline.

## Inputs

| Field | Required |
|-------|----------|
| company | Sim |
| stage | Sim — pre-seed / seed / serie-a / serie-b / growth / debt |
| amount_needed | Sim — quanto precisa levantar |
| use_of_funds | Sim — para que vai usar o capital |
| current_metrics | Sim — ARR/MRR, crescimento, burn, runway atual |
| market | Não — BR ou US/global |

## Execution (Orquestração)

1. **Brazil Market** (se BR): calibra instrumento, investidores, valuation de mercado BR
2. **Capital Architect**: define instrumento (equity/dívida/híbrido) e termos defensáveis
3. **Damodaran**: ancora a valuation pré-money com lógica de múltiplos + crescimento
4. **CFO Architect**: valida que o valor levantado é suficiente para o milestone

## Output Format

```
## Fundraise Strategy: [Company] — [Stage]

### Diagnóstico
- **Runway atual:** X meses
- **Milestone para próximo round:** [o que precisa ser verdade]
- **Capital necessário para chegar lá:** R$X (com buffer de X meses)

### Instrumento Recomendado
**Tipo:** [Equity / Nota Conversível / Dívida / BNDES / Misto]
**Justificativa:** [por que este instrumento neste momento]

### Valuation
**Pré-money defensável:** R$X – R$X
**Metodologia:** [ARR multiple / VC method / DCF / comps mercado BR]
**Benchmarks usados:** [fonte]
**Post-money (com X% dilution):** R$X

### Termos Padrão para Negociar
- Liquidation preference: [1x non-participating recomendado]
- Anti-dilution: [broad-based WA padrão]
- Pro-rata: [sim/não]
- Board seat: [sim/não — threshold]

### Target Investors
| Investidor | Fit | Ticket médio | Thesis |
|-----------|-----|-------------|--------|
| [Investidor 1] | Alto | R$X-X | [por que faz sentido] |
| [Investidor 2] | | | |

### Processo e Timeline
- **Mês 1:** Preparação (deck, data room, modelo)
- **Mês 2-3:** Outreach e primeiras reuniões
- **Mês 3-4:** Term sheets
- **Mês 4-5:** Due diligence e fechamento

### Red Flags para Evitar
- [Term sheet com full ratchet anti-dilution]
- [Liquidation preference 2x participante]
- [Prazo abaixo de 18 meses para próximo round]

### CADE Check (se BR)
**Obrigatório?** [Sim/Não] — faturamento do investidor no BR: R$X
```
