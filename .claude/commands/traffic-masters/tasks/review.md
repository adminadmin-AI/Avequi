---
task: reviewPaidTrafficOutput()
responsavel: "@traffic-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: specialist_output
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: original_request
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: reviewReport
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] All checklist items evaluated"
  - "[ ] Verdict rendered (APPROVE/REVISE/REJECT)"
  - "[ ] Budget allocation and targeting individually assessed"
---

# Task: Review Paid Traffic Output

**Task ID:** TRAFFIC-CHIEF-002
**Version:** 1.0.0
**Command:** `*review`
**Orchestrator:** Traffic Chief (traffic-chief)
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
4. Identify the platform(s): Meta Ads, Google Ads, TikTok Ads, LinkedIn Ads, etc.
5. Determine the campaign objective: awareness, traffic, leads, conversions, ROAS

### Phase 2: Apply Quality Checklist

1. Load checklists/output-quality.md
2. Evaluate each item against the specialist output
3. Mark each item: [x] Pass, [ ] Fail, [N/A] Not Applicable
4. Count CRITICAL failures and total failures
5. Pay special attention to: targeting precision, budget justification, creative compliance, and KPI definition

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

### Traffic-Specific Notes
- Platform compliance: {assessment}
- Targeting quality: {assessment}
- Expected ROAS/CPA: {assessment}

### Recommendation
{Next step: deliver / revise specific items / redo}
```

---

## Veto Conditions

- NEVER approve output with CRITICAL failures
- NEVER reject without providing specific, actionable feedback
- NEVER modify the specialist's output — only review and provide feedback
- NEVER approve campaigns without defined KPIs and success metrics
- NEVER approve targeting that violates platform advertising policies

---

## Completion Criteria

- [ ] Original request re-read and understood
- [ ] Platform and campaign objective identified
- [ ] All checklist items evaluated
- [ ] Score calculated
- [ ] Verdict rendered (APPROVE/REVISE/REJECT)
- [ ] Specific feedback provided for any failures
- [ ] Budget allocation and targeting individually assessed
