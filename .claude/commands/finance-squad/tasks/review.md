---
task: reviewFinance()
responsavel: "@finance-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: false

Entrada:
  - campo: deliverable
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: review
    tipo: string
    destino: Console
    persistido: false
---

# Task: Review Financial Deliverable

**Command:** `*review`
**Agent:** Finance Chief (finance-chief) with specialist review
**Purpose:** Quality review of any financial deliverable — model, analysis, memo, or recommendation.

---

## Execution

Finance Chief reviews the deliverable against 6 quality dimensions:

1. **Accuracy** — Numbers internally consistent, math checks out
2. **Assumptions** — Explicit, labeled, defensible, sourced
3. **Framework** — Right framework applied to the question
4. **Downside** — Stress test and worst case presented
5. **Actionability** — Clear recommendation with decision criteria
6. **Clarity** — Can a smart non-finance reader follow it?

---

## Output Format

```
## Finance Review: [Deliverable Name]

### Overall: PASS / NEEDS WORK / FAIL

| Dimension | Score | Finding |
|-----------|-------|---------|
| Accuracy | ✅/⚠️/❌ | [finding] |
| Assumptions | ✅/⚠️/❌ | [finding] |
| Framework | ✅/⚠️/❌ | [finding] |
| Downside | ✅/⚠️/❌ | [finding] |
| Actionability | ✅/⚠️/❌ | [finding] |
| Clarity | ✅/⚠️/❌ | [finding] |

### Critical Issues (must fix before delivery)
1. [Issue 1]
2. [Issue 2]

### Advisory (recommended improvements)
1. [Advisory 1]
2. [Advisory 2]

### Specialist Notes
[Any specific framework concerns from the relevant specialist domain]
```
