---
task: diagnoseFinance()
responsavel: "@finance-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: company
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: question
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: diagnosis
    tipo: string
    destino: Console
    persistido: false
---

# Task: Diagnose Financial Problem

**Command:** `*diagnose`
**Agent:** Finance Chief (finance-chief)
**Purpose:** Quickly diagnose which financial domain the problem belongs to and route to the right specialist.

---

## Inputs

| Field | Type | Required |
|-------|------|----------|
| company | string | Yes — company name or description |
| question | string | Yes — the financial question or problem |
| stage | string | No — company stage (pre-revenue, early, growth, mature) |
| revenue | string | No — approximate revenue (helps calibrate advice) |

---

## Execution

The Finance Chief will:

1. **Understand the business context** — What kind of company? What stage?
2. **Clarify the real question** — Surface vs. deeper financial problem
3. **Identify the domain** — Valuation, FP&A, Capital Structure, M&A, or Modeling
4. **Route to the right specialist** — With context on what to focus on
5. **Preview the approach** — What framework will be applied and why

---

## Output Format

```
## Financial Diagnosis

**Company:** [name/description]
**Stated Problem:** [what they said]
**Real Problem:** [deeper diagnosis]
**Domain:** [Valuation / FP&A / Capital Structure / M&A / Modeling]

## Routing

**Specialist:** [agent name]
**Framework:** [applicable framework]
**Why this agent:** [rationale]

## Priority Questions to Answer
1. [Question 1]
2. [Question 2]
3. [Question 3]

## Next Step
[Specific action — e.g., "Run /finance-squad/tasks/value-company with the following inputs..."]
```
