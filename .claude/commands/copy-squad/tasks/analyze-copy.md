---
task: analyzeCopy()
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
  - campo: copy_analysis
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] 8-dimension scorecard completed with notes"
  - "[ ] #1 priority fix identified with rewrite suggestions"
  - "[ ] Specialist routing recommendations included"
---

# Task: Analyze Copy

**Task ID:** COPY-006
**Version:** 1.0.0
**Command:** `*analyze-copy`
**Agent:** Copy Chief (copy-chief)
**Purpose:** Analyze existing copy to identify weaknesses, missed opportunities, and improvement priorities.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| copy_text | string | User prompt | Yes | The copy to analyze (pasted or referenced) |
| copy_type | enum | User prompt | Yes | headline, sales-letter, email, vsl, ad, landing-page, funnel |
| goal | string | User prompt | Yes | What the copy is trying to achieve |
| audience | string | User prompt | No | Target audience description |
| metrics | object | User prompt | No | Current performance data (CTR, conversion rate, etc.) |
| context | string | User prompt | No | Where and how the copy is used |

---

## Preconditions

- Copy text provided in full (partial copy yields partial analysis)
- Copy type identified so correct evaluation criteria are applied

---

## Execution Phases

### Phase 1: First-Pass Read
1. Read the copy as a prospect would — note where attention drops
2. Identify the big promise (is there one?)
3. Identify the primary CTA (is it clear?)
4. Note first emotional reaction: bored, confused, intrigued, skeptical, convinced
5. Time how long the copy holds attention before the mind wanders

### Phase 2: Structural Analysis
1. Evaluate the headline/hook:
   - Does it stop the reader?
   - Does it select the right audience?
   - Does it promise a benefit or arouse curiosity?
2. Evaluate the lead (first 100-300 words):
   - Does it earn the next paragraph?
   - Is the awareness level calibrated correctly?
3. Evaluate the body:
   - Is there a clear logical and emotional flow?
   - Are benefits concrete or vague?
   - Is proof present and strategically placed?
4. Evaluate the close:
   - Is the offer clear?
   - Is the CTA specific and actionable?
   - Is there urgency without being fake?
5. Evaluate the overall "slippery slide" — can you stop reading anywhere?

### Phase 3: Scoring and Recommendations
1. Score across 8 dimensions (1-10 each):
   - Headline Power
   - Lead Engagement
   - Emotional Connection
   - Proof and Credibility
   - Benefit Clarity
   - Offer Strength
   - CTA Effectiveness
   - Flow and Readability
2. Calculate overall score (average)
3. Identify the #1 weakness that would yield the biggest improvement
4. Provide 3 specific, actionable rewrites for the weakest sections
5. Recommend which Copy Squad specialist could improve each weak area

---

## Output Format

```markdown
## Copy Analysis

**Type:** {copy_type}
**Goal:** {goal}
**Overall Score:** {X}/10
**Verdict:** {Weak / Needs Work / Solid / Strong / Elite}

---

### Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Headline Power | X/10 | {brief note} |
| Lead Engagement | X/10 | {brief note} |
| Emotional Connection | X/10 | {brief note} |
| Proof and Credibility | X/10 | {brief note} |
| Benefit Clarity | X/10 | {brief note} |
| Offer Strength | X/10 | {brief note} |
| CTA Effectiveness | X/10 | {brief note} |
| Flow and Readability | X/10 | {brief note} |

---

### #1 Priority Fix
{The single change that would have the biggest impact}

### Top 3 Rewrite Suggestions
1. **{Section}:** {Current text} → {Suggested rewrite} — {Why this is better}
2. ...
3. ...

### Specialist Recommendations
| Weak Area | Recommended Agent | Why |
|-----------|-------------------|-----|

### What's Working Well
{Acknowledge strengths — what to preserve}
```

---

## Veto Conditions

- NEVER analyze without reading the complete copy
- NEVER give a score without specific justification
- NEVER provide only criticism — always acknowledge what works
- NEVER recommend rewrites that change the core offer or promise without flagging it
- NEVER ignore performance metrics if provided — data overrides opinion

---

## Completion Criteria

- [ ] Full copy read and first-pass impression documented
- [ ] Structural analysis completed (headline, lead, body, close)
- [ ] 8-dimension scorecard completed with notes
- [ ] #1 priority fix identified
- [ ] 3 specific rewrite suggestions provided
- [ ] Specialist routing recommendations included
- [ ] Strengths acknowledged
