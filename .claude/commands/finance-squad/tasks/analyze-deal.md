---
task: analyzeDeal()
responsavel: "@deal-maker"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: target
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: deal_type
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: dealAnalysis
    tipo: string
    destino: Console
    persistido: false
---

# Task: Analyze a Deal

**Command:** `*analyze-deal`
**Agent:** Deal Maker (deal-maker)
**Purpose:** Full buy-side M&A analysis: strategic rationale, valuation, synergies, structure, and go/no-go recommendation.

---

## Inputs

| Field | Type | Required |
|-------|------|----------|
| target | string | Yes — target company name and description |
| deal_type | string | Yes — acquisition, merger, strategic partnership, divestiture |
| acquirer | string | No — acquiring company context |
| deal_size | number | No — indicative deal size or price range |
| strategic_rationale | string | No — why do this deal? |
| synergies | string | No — known synergy hypothesis |

---

## Execution

Deal Maker will:

1. **Assess strategic rationale** — Why this deal? Buy vs. build comparison
2. **Value the target standalone** — Reference Damodaran framework
3. **Estimate synergies** — Revenue + cost, with realism discount
4. **Determine maximum bid** — Standalone + synergies - integration costs - required return
5. **Recommend deal structure** — Cash/stock/earnout, escrow provisions
6. **Identify key diligence areas** — What must be true for this deal to work?
7. **Go/no-go recommendation** — With specific conditions

---

## Output Format

```
## Deal Analysis: [Acquirer] / [Target]

### Strategic Rationale
**Why this deal:** [2-3 sentences]
**Buy vs. Build verdict:** [Buy / Build / Partner — and why]
**Strategic risk if we don't do it:** [Low / Medium / High]

### Valuation
**Target Standalone Value:** $[X]M - $[X]M
**Basis:** [DCF / comps / multiple — brief rationale]

### Synergy Analysis
| Category | Gross Estimate | Realism Discount | Net Value |
|----------|---------------|-----------------|-----------|
| Revenue synergies | $XM | 40% | $XM |
| Cost synergies | $XM | 20% | $XM |
| Financial synergies | $XM | 10% | $XM |
| **Total** | | | **$XM** |

**Integration Costs:** -$[X]M (one-time)

### Maximum Bid
**Formula:** Standalone ($XM) + Net Synergies ($XM) - Integration ($XM) = **$[X]M**
**Current Market Price / Ask:** $[X]M
**Value Creation at Ask:** $[X]M (or X% of synergies captured)

### Recommended Deal Structure
- **Consideration:** [Cash / Stock / Mixed — % split]
- **Earnout:** [Yes/No — terms if applicable]
- **Escrow:** [% and duration]
- **Key reps & warranties:** [critical protections needed]

### Critical Diligence Items
1. [Item 1] — if this fails, deal falls apart
2. [Item 2]
3. [Item 3]

### Go / No-Go Recommendation
**Verdict:** [GO / NO-GO / CONDITIONAL GO]
**Conditions:** [if conditional]
**Biggest risk:** [single biggest thing that could make this a bad deal]
```
