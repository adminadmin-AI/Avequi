---
task: valueCompany()
responsavel: "@damodaran"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: company
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: revenue
    tipo: number
    origem: User Input
    obrigatorio: true
  - campo: ebitda
    tipo: number
    origem: User Input
    obrigatorio: false

Saida:
  - campo: valuation
    tipo: string
    destino: Console
    persistido: false
---

# Task: Value a Company

**Command:** `*value-company`
**Agent:** Damodaran (damodaran)
**Purpose:** Produce a rigorous company valuation using DCF + comparable multiples triangulation.

---

## Inputs

| Field | Type | Required |
|-------|------|----------|
| company | string | Yes — company name and business description |
| revenue | number | Yes — LTM (Last Twelve Months) revenue |
| ebitda | number | No — LTM EBITDA or EBIT |
| growth_rate | number | No — Historical or projected revenue growth rate |
| gross_margin | number | No — Gross margin % |
| sector | string | No — Industry sector for comps |
| purpose | string | No — Why valuing? (fundraise, acquisition, exit, curiosity) |

---

## Execution

Damodaran will:

1. **Understand the business story** — growth engine, moats, risks
2. **Build DCF framework** — explicit period assumptions + terminal value
3. **Run comparable analysis** — public comps and precedent transactions if available
4. **Triangulate** — DCF intrinsic value vs. market multiples
5. **Produce valuation range** — Bear / Base / Bull with key assumptions
6. **Sensitivity analysis** — WACC vs. terminal growth, revenue vs. margin

---

## Output Format

```
## Company Valuation: [Company Name]

### Business Story
[2-3 sentences on growth engine, moat, key risks]

### DCF Valuation
**Revenue Projections (5Y):** [Year 1-5 revenue]
**EBITDA Margin Trajectory:** [Base case]
**WACC:** [%] (Rf: [%], Beta: [x], ERP: [%])
**Terminal Growth Rate:** [%]
**Enterprise Value (DCF):** $[X]M
**Equity Value (DCF):** $[X]M (after $[X]M net debt)

### Comparable Multiples
| Multiple | Low | Median | High | Applied |
|----------|-----|--------|------|---------|
| EV/Revenue | | | | |
| EV/EBITDA | | | | |

**Enterprise Value (Comps):** $[X]M - $[X]M

### Valuation Summary
| Scenario | EV | Equity Value | $/share (if applicable) |
|----------|----|-------------|------------------------|
| Bear | | | |
| Base | | | |
| Bull | | | |

### Sensitivity: WACC vs. Terminal Growth Rate
[Table]

### Key Value Drivers
1. [Driver 1] — most impactful assumption
2. [Driver 2]
3. [Driver 3]

### Assumptions to Pressure Test
- [Most uncertain assumption 1]
- [Most uncertain assumption 2]
```
