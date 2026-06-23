---
task: review()
responsavel: "@copy-master-chief"
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
  - "[ ] Specific feedback provided for any failures"
  - "[ ] Persuasion psychology checkpoint passed"
---

# Task: Review Copywriting Output

**Task ID:** COPY-M-CHIEF-002
**Version:** 2.0.0
**Command:** `*review`
**Orchestrator:** Copy Master Chief (copy-master-chief)
**Purpose:** Review specialist output against quality checklist including persuasion psychology standards, score, and approve or request revision.

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
4. Identify the target audience and conversion goal
5. Determine the medium (email, landing page, ad, sales letter, etc.)

### Phase 2: Apply Quality Checklist

1. Load checklists/output-quality.md
2. Evaluate each item against the specialist output
3. Mark each item: [x] Pass, [ ] Fail, [N/A] Not Applicable
4. Count CRITICAL failures and total failures
5. Pay special attention to: headline strength, lead hook, offer clarity, and CTA power

### Phase 3: Persuasion Psychology Checkpoint

1. Verify Cialdini principles are present and appropriately applied:
   - At minimum 3 of 7 principles should be active in any deliverable
   - No principle should be applied in a manipulative or deceptive way
   - Principles should be woven naturally, not bolted on
2. Verify Blair Warren levers are utilized:
   - At minimum 2 of 5 levers should be activated
   - Levers should match the audience's emotional state
3. Check the Hormozi Value Equation (for offers only):
   - All 4 dimensions scored
   - Bonuses mapped to specific dimensions they improve
4. Flag any persuasion psychology gaps as WARN items

### Phase 4: Score and Decide

| Score | Verdict | Action |
|-------|---------|--------|
| All CRITICAL pass, < 2 non-critical fail, psychology checkpoint pass | APPROVE | Deliver to user |
| All CRITICAL pass, 2+ non-critical fail OR psychology gap | REVISE | Return to specialist with specific feedback |
| Any CRITICAL fail | REJECT | Return to specialist, block delivery |

### Phase 5: Output

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

### Persuasion Psychology Checkpoint
- Cialdini principles active: {count}/7 — {list}
- Warren levers active: {count}/5 — {list}
- Hormozi Value Equation: {scored/not-applicable}
- Psychology verdict: {PASS/GAP — description}

### Copy-Specific Notes
- Headline effectiveness: {assessment}
- Emotional resonance: {assessment}
- Conversion likelihood: {assessment}

### Recommendation
{Next step: deliver / revise specific items / redo}
```

---

## Veto Conditions

- NEVER approve output with CRITICAL failures
- NEVER reject without providing specific, actionable feedback
- NEVER modify the specialist's output — only review and provide feedback
- NEVER approve copy that makes unsubstantiated claims
- NEVER approve copy that lacks a clear call to action

---

## Completion Criteria

- [ ] Original request re-read and understood
- [ ] Target audience and medium identified
- [ ] All checklist items evaluated
- [ ] Persuasion psychology checkpoint completed
- [ ] Score calculated
- [ ] Verdict rendered (APPROVE/REVISE/REJECT)
- [ ] Specific feedback provided for any failures
- [ ] Headline, lead, and CTA individually assessed
