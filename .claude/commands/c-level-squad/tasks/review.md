---
task: review()
responsavel: "@vision-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: specialist_output
    tipo: string
    origem: Specialist Agent
    obrigatorio: true
  - campo: original_request
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: review_report
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] All checklist items evaluated and scored"
  - "[ ] Verdict rendered (APPROVE/REVISE/REJECT)"
  - "[ ] Strategic alignment and financial rigor assessed"
---

# Task: Review Executive Strategy Output

**Task ID:** CLEVEL-CHIEF-002
**Version:** 1.0.0
**Command:** `*review`
**Orchestrator:** Vision Chief (vision-chief)
**Purpose:** Review specialist output against quality checklist, score, and approve or request revision.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| specialist_output | string | Specialist agent | Yes | Non-empty deliverable |
| original_request | string | User prompt | Yes | The original request that triggered the work |
| specialist_id | string | Routing | Yes | Agent ID that produced the output |

---

## Preconditions

- Specialist has completed their task and produced output
- Output quality checklist is available at checklists/output-quality.md

---

## Execution Phases

### Phase 1: Understand Context

1. Re-read the original user request
2. Identify what was asked vs what was delivered
3. Note the specialist who produced the output
4. Identify the executive function: CEO vision, CFO finance, COO operations, CMO market, CTO technology
5. Determine the strategic horizon: tactical (0-6mo), operational (6-18mo), strategic (18mo+)

### Phase 2: Apply Quality Checklist

1. Load checklists/output-quality.md
2. Evaluate each item against the specialist output
3. Mark each item: [x] Pass, [ ] Fail, [N/A] Not Applicable
4. Count CRITICAL failures and total failures
5. Pay special attention to: strategic alignment, financial implications, risk assessment, and timeline realism

### Phase 3: Score and Decide

| Score | Verdict | Action |
|-------|---------|--------|
| All CRITICAL pass, < 2 non-critical fail | APPROVE | Deliver to user |
| All CRITICAL pass, 2+ non-critical fail | REVISE | Return to specialist with specific feedback |
| Any CRITICAL fail | REJECT | Return to specialist, block delivery |

### Phase 4: Output

Produce review report with verdict, score, and feedback.

---

## Output Format

```markdown
## Review Report

**Specialist:** {name} ({id})
**Verdict:** {APPROVE | REVISE | REJECT}
**Score:** {X}/{total} items passed

### Passed
- {items that passed}

### Issues Found
- [{CRITICAL|WARN}] {description} — {recommendation}

### Executive-Specific Notes
- Strategic alignment: {assessment}
- Financial rigor: {assessment}
- Execution feasibility: {assessment}

### Recommendation
{Next step: deliver / revise specific items / redo}
```

---

## Veto Conditions

- NEVER approve output with CRITICAL failures
- NEVER reject without providing specific, actionable feedback
- NEVER modify the specialist's output — only review and provide feedback
- NEVER approve strategy without financial implications or resource requirements
- NEVER approve timelines without milestones and accountability structure

---

## Completion Criteria

- [ ] Original request re-read and understood
- [ ] Executive function and strategic horizon identified
- [ ] All checklist items evaluated
- [ ] Score calculated
- [ ] Verdict rendered (APPROVE/REVISE/REJECT)
- [ ] Specific feedback provided for any failures
- [ ] Strategic alignment, financial rigor, and feasibility individually assessed
