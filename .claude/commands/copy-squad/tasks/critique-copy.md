---
task: critiqueCopy()
responsavel: "@copy-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: copy_text
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: copy_type
    tipo: enum
    origem: User Input
    obrigatorio: true

Saida:
  - campo: critique_report
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] All 8 criteria scored with justification"
  - "[ ] Fatal flaw identified with rewrite examples"
  - "[ ] Prioritized fix list with specialist routing"
---

# Task: Critique Copy

**Task ID:** COPY-011
**Version:** 1.0.0
**Command:** `*critique-copy`
**Agent:** Copy Chief (copy-chief)
**Purpose:** Deliver a structured 8-point copy critique with scored assessment and prioritized fixes.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| copy_text | string | User prompt | Yes | Full copy to critique |
| copy_type | enum | User prompt | Yes | headline, sales-letter, email, vsl-script, ad, landing-page, funnel, bullets |
| original_brief | string | User prompt | No | Original brief or goal the copy was written for |
| target_audience | string | User prompt | No | Intended audience |
| performance_data | object | User prompt | No | Existing metrics if the copy is live |

---

## Preconditions

- Complete copy text provided (not fragments)
- Copy type identified for correct scoring criteria

---

## Execution Phases

### Phase 1: Objective Assessment
1. Read the copy through once without judgment — note gut reactions
2. Read again with the 8-point scoring framework active
3. For each of the 8 criteria, assign a score (1-10):
   - **Attention (Headline/Hook):** Does it stop the right person?
   - **Interest (Lead/Opening):** Does it earn the next 100 words?
   - **Desire (Benefits/Proof):** Does it make the reader want the outcome?
   - **Action (CTA/Close):** Does it compel immediate action?
   - **Specificity:** Are claims concrete with numbers, names, and details?
   - **Proof:** Is every claim backed by evidence?
   - **Voice:** Is there a consistent, compelling personality?
   - **Flow:** Can you stop reading anywhere, or does it pull you through?
4. Calculate composite score and assign verdict:
   - 80-100: Elite — minor polish only
   - 60-79: Strong — targeted improvements needed
   - 40-59: Needs Work — significant rewrites required
   - Below 40: Weak — consider starting over with new approach

### Phase 2: Deep Critique
1. For each criterion scoring below 7, provide:
   - What specifically is wrong (cite the exact text)
   - Why it matters (what it costs in conversions or engagement)
   - How to fix it (specific rewrite suggestion)
2. Identify the "fatal flaw" — the single biggest issue killing performance
3. Assess awareness level calibration — is the copy pitched at the right level?
4. Check for "copy crimes":
   - Talking about yourself before talking about the reader
   - Features without benefits
   - Claims without proof
   - Vague language where specifics could be used
   - Passive voice in the CTA
   - Multiple CTAs competing for attention

### Phase 3: Actionable Recommendations
1. Provide a prioritized fix list (highest impact first)
2. For the top 3 fixes, write actual rewrite examples
3. Recommend which specialist agent could best handle each fix
4. If performance data provided, correlate weak scores with metric drops
5. Provide a "quick wins" section — changes that take under 5 minutes

---

## Output Format

```markdown
## Copy Critique Report

**Copy Type:** {type}
**Composite Score:** {X}/80 ({percentage}%)
**Verdict:** {Elite / Strong / Needs Work / Weak}
**Fatal Flaw:** {one-line description}

---

### 8-Point Scorecard

| # | Criterion | Score | Status |
|---|-----------|-------|--------|
| 1 | Attention | X/10 | {Pass/Fix} |
| 2 | Interest | X/10 | {Pass/Fix} |
| 3 | Desire | X/10 | {Pass/Fix} |
| 4 | Action | X/10 | {Pass/Fix} |
| 5 | Specificity | X/10 | {Pass/Fix} |
| 6 | Proof | X/10 | {Pass/Fix} |
| 7 | Voice | X/10 | {Pass/Fix} |
| 8 | Flow | X/10 | {Pass/Fix} |

---

### Detailed Critique

#### {Criterion Name} — {Score}/10
**Issue:** {what's wrong — cite exact text}
**Impact:** {what it costs}
**Fix:** {specific recommendation}
**Rewrite:** {before → after example}

---

### Copy Crimes Detected
- {crime}: {where it occurs}

### Prioritized Fix List
| Priority | Fix | Impact | Effort | Agent |
|----------|-----|--------|--------|-------|
| 1 | {fix} | High | {Low/Med/High} | {agent} |

### Quick Wins (Under 5 Minutes)
1. {quick fix}
2. {quick fix}
3. {quick fix}

### What to Keep
{Acknowledge what the copy does well}
```

---

## Veto Conditions

- NEVER critique without scoring all 8 criteria
- NEVER provide scores without justification and specific text references
- NEVER deliver only criticism — always acknowledge strengths
- NEVER suggest rewrites that change the fundamental offer or promise
- NEVER ignore performance data if provided — metrics trump opinions

---

## Completion Criteria

- [ ] All 8 criteria scored with justification
- [ ] Composite score calculated and verdict assigned
- [ ] Fatal flaw identified
- [ ] Detailed critique for all criteria scoring below 7
- [ ] Top 3 rewrite examples provided
- [ ] Prioritized fix list with specialist routing
- [ ] Quick wins section included
- [ ] Strengths acknowledged
