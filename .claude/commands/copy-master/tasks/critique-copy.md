---
task: critiqueCopy()
responsavel: "@copy-master-chief"
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
  - "[ ] Persuasion psychology audit completed"
---

# Task: Critique Copy

**Task ID:** COPY-M-011
**Version:** 2.0.0
**Command:** `*critique-copy`
**Agent:** Copy Master Chief (copy-master-chief)
**Purpose:** Deliver a structured 8-point copy critique with scored assessment, prioritized fixes, and persuasion psychology audit.

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

## Champion Reference

Use these critique frameworks as reference standards:

1. **Gary Halbert's "Read It Aloud" Test** — If it doesn't sound like one person talking to another, rewrite it
2. **Eugene Schwartz's Awareness Level Audit** — Is the copy addressing the right awareness stage?
3. **David Ogilvy's "Would It Make Me Buy?"** — The ultimate honest test of copy effectiveness
4. **Claude Hopkins' "Reason Why" Audit** — Does every claim have a reason to believe?
5. **Joanna Wiebe's "Copy Crimes" Checklist** — Systematic detection of conversion-killing mistakes

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

### Phase 2: Persuasion Psychology Audit
1. Audit Cialdini's 7 principles:
   - For each principle: Present? Where? How strong (1-5)?
   - Identify which principles are missing entirely
   - Flag principles that are present but poorly executed
2. Audit Blair Warren's 5 levers:
   - Does the copy encourage dreams, justify failures, allay fears, confirm suspicions, throw rocks?
   - Which levers are activated? Which are missing?
3. Score persuasion density: Total active principles / Total possible (12)
4. Identify the #1 persuasion gap with highest potential impact

### Phase 3: Deep Critique
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

### Phase 4: Actionable Recommendations
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

### Persuasion Psychology Audit

| Cialdini Principle | Present? | Strength (1-5) | Location | Fix Needed? |
|-------------------|----------|----------------|----------|-------------|
| Reciprocity | Y/N | X | {where} | {Y/N} |
| Commitment | Y/N | X | {where} | {Y/N} |
| Social Proof | Y/N | X | {where} | {Y/N} |
| Authority | Y/N | X | {where} | {Y/N} |
| Liking | Y/N | X | {where} | {Y/N} |
| Scarcity | Y/N | X | {where} | {Y/N} |
| Unity | Y/N | X | {where} | {Y/N} |

| Warren Lever | Present? | Location |
|-------------|----------|----------|
| Encourage dreams | Y/N | {where} |
| Justify failures | Y/N | {where} |
| Allay fears | Y/N | {where} |
| Confirm suspicions | Y/N | {where} |
| Throw rocks | Y/N | {where} |

**Persuasion Density:** {X}/12 principles active ({percentage}%)
**#1 Persuasion Gap:** {missing principle + where to add it}

---

### Detailed Critique

#### {Criterion Name} — {Score}/10
**Issue:** {what's wrong — cite exact text}
**Impact:** {what it costs}
**Fix:** {specific recommendation}
**Rewrite:** {before -> after example}

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
- [ ] Persuasion Psychology Audit completed (7 Cialdini + 5 Warren)
- [ ] Persuasion density scored
- [ ] #1 persuasion gap identified with fix recommendation
- [ ] Detailed critique for all criteria scoring below 7
- [ ] Top 3 rewrite examples provided
- [ ] Prioritized fix list with specialist routing
- [ ] Quick wins section included
- [ ] Strengths acknowledged
