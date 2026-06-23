---
task: writeVslScript()
responsavel: "@stefan-georgi"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: offer
    tipo: object
    origem: User Input
    obrigatorio: true

Saida:
  - campo: vsl_script
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] RMBC framework fully executed (all 4 sections)"
  - "[ ] Hook compelling in first 60 seconds"
  - "[ ] Visual direction cues and production notes included"
---

# Task: Write VSL Script

**Task ID:** COPY-003
**Version:** 1.0.0
**Command:** `*write-vsl-script`
**Agent:** Stefan Georgi (stefan-georgi)
**Purpose:** Write a Video Sales Letter script using the RMBC method.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Product/service with transformation it delivers |
| audience | string | User prompt | Yes | Target audience with emotional state and desires |
| offer | object | User prompt | Yes | Price, guarantee, bonuses, urgency |
| duration_target | string | User prompt | No | short (10-15min), medium (20-30min), long (45-60min) — defaults to medium |
| unique_mechanism | string | User prompt | No | What makes this solution different |
| proof_elements | list | User prompt | No | Testimonials, results, credentials |
| platform | string | User prompt | No | Where the VSL will run (landing page, YouTube, webinar) |

---

## Preconditions

- Product transformation clearly defined (before/after state)
- Offer structure complete with price and guarantee
- Target audience emotional triggers identified

---

## Execution Phases

### Phase 1: RMBC Framework Setup
1. **R — Relate:** Define the relatable opening story or scenario
   - Identify a moment the prospect has lived through
   - Choose first-person or second-person narrative angle
   - Map the emotional hook (frustration, shame, fear, desperation)
2. **M — Mechanism:** Define the unique mechanism
   - Name the mechanism (give it a proprietary name if possible)
   - Explain why everything else failed (invalidate competitors)
   - Build credibility for the mechanism with proof or logic
3. **B — Benefits:** Stack the benefits in emotional order
   - Lead with the #1 transformation
   - Layer secondary benefits that paint the "new life"
   - Use future-pacing to make benefits visceral
4. **C — Close:** Structure the close sequence
   - Price anchoring strategy
   - Guarantee positioning
   - Bonus stack with individual value calls
   - Urgency/scarcity element
   - Final CTA with exact next step

### Phase 2: Script Writing
1. Write the hook (first 60 seconds) — must stop the scroll and earn attention
2. Write the "relate" section with story arc (struggle → discovery → transformation)
3. Transition to mechanism reveal with pattern interrupt
4. Present benefits using "imagine..." and "what if..." language
5. Insert proof blocks between major sections (testimonials, stats, demos)
6. Write the close with price reveal, stack, guarantee, and urgency
7. Add bumps and order form copy if applicable
8. Write the "walk away" close — what happens if they do nothing

### Phase 3: Production Notes
1. Add visual/slide direction cues in brackets
2. Mark emphasis points for voice modulation
3. Identify where B-roll or demonstration footage should appear
4. Estimate runtime at 150 words/minute speaking pace
5. Flag sections that can be cut for shorter versions

---

## Output Format

```markdown
## VSL Script: {Product Name}

**Method:** RMBC (Relate-Mechanism-Benefits-Close)
**Target Duration:** {X} minutes (~{Y} words)
**Audience:** {audience}
**Emotional Hook:** {primary emotion}
**Unique Mechanism:** {mechanism name}

---

### HOOK (0:00 - 1:00)
{Opening hook script}
[VISUAL: {direction}]

### RELATE (1:00 - {X}:00)
{Relatable story section}
[VISUAL: {direction}]

### MECHANISM ({X}:00 - {Y}:00)
{Mechanism reveal and explanation}
[VISUAL: {direction}]

### BENEFITS ({Y}:00 - {Z}:00)
{Benefits stack with future-pacing}
[VISUAL: {direction}]

### PROOF BLOCKS
{Testimonial/proof insertions with timestamps}

### CLOSE ({Z}:00 - END)
{Price reveal, stack, guarantee, urgency, CTA}
[VISUAL: {direction}]

---

### Production Notes
- **Estimated runtime:** {X} minutes
- **Word count:** {Y}
- **Key visual moments:** {list}
- **Suggested A/B tests:** {hook variant, close variant}
```

---

## Veto Conditions

- NEVER skip the Relate section — without emotional connection the VSL fails
- NEVER reveal the product before establishing the mechanism
- NEVER present price without anchoring to a higher value first
- NEVER write a VSL without visual/slide direction cues
- NEVER exceed target duration by more than 20%

---

## Completion Criteria

- [ ] RMBC framework fully executed (all 4 sections present)
- [ ] Hook is compelling in the first 60 seconds
- [ ] Unique mechanism named and explained
- [ ] Proof blocks inserted between major sections
- [ ] Close includes price anchoring, guarantee, bonus stack, urgency
- [ ] Visual direction cues included throughout
- [ ] Runtime estimate calculated
- [ ] Production notes provided
