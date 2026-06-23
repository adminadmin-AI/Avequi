---
task: writeEmailSequence()
responsavel: "@andre-chaperon"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: sequence_type
    tipo: enum
    origem: User Input
    obrigatorio: true

Saida:
  - campo: email_sequence
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Sequence type framework correctly applied"
  - "[ ] All emails written with dual subject lines"
  - "[ ] Open loops planted and resolved across sequence"
---

# Task: Write Email Sequence

**Task ID:** COPY-004
**Version:** 1.0.0
**Command:** `*write-email-sequence`
**Agent:** Andre Chaperon (andre-chaperon) or Ben Settle (ben-settle)
**Purpose:** Write email sequences that build relationship and drive action through serialized storytelling.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Product/service being promoted |
| audience | string | User prompt | Yes | Subscriber profile and emotional state |
| sequence_type | enum | User prompt | Yes | soap-opera, daily, nurture, launch, welcome, cart-abandon |
| num_emails | number | User prompt | No | Defaults by type: soap-opera=5, daily=7, nurture=10, launch=7, welcome=5, cart-abandon=3 |
| offer | object | User prompt | No | Required for soap-opera and launch types |
| brand_voice | string | User prompt | No | Tone and personality of the sender |
| entry_point | string | User prompt | No | What opt-in or action triggered this sequence |

---

## Preconditions

- Sequence type selected with clear goal (sell, nurture, onboard, recover)
- Audience pain points and desires identified
- For soap-opera and launch types: offer must be defined

---

## Execution Phases

### Phase 1: Sequence Architecture
1. Define the narrative arc across the full sequence
2. Map email-by-email purpose using the sequence framework:
   - **Soap Opera:** Hook → Backstory → Epiphany → Hidden Benefits → Urgency
   - **Daily:** Standalone value emails with embedded soft sells
   - **Nurture:** Education → Trust → Authority → Bridge to offer
   - **Launch:** Anticipation → Value → Social Proof → Objection Handling → Cart Open → FAQ → Cart Close
   - **Welcome:** Gratitude → Quick Win → Story → Expectations → Next Step
   - **Cart Abandon:** Reminder → Objection Handle → Final Urgency
3. Assign one emotional theme per email
4. Plan open loops between emails (Chaperon's signature technique)

### Phase 2: Write Each Email
1. Write subject lines (2 options per email, one curiosity-based, one benefit-based)
2. Write preview text that complements (not repeats) the subject line
3. Write email body following the one-email-one-idea rule
4. Open each email with a hook that earns the next sentence
5. Close each email with either an open loop (mid-sequence) or CTA (selling emails)
6. Maintain consistent voice throughout — the reader should feel they know the sender
7. Include P.S. lines on selling emails

### Phase 3: Sequence Optimization
1. Review the emotional arc — does tension build across the sequence?
2. Verify open loops are planted and resolved at the right moments
3. Check that no email feels like a standalone — each must reference the thread
4. Add send timing recommendations (delays between emails)
5. Suggest segmentation triggers (link clicks, opens, no-opens)

---

## Output Format

```markdown
## Email Sequence: {Name}

**Type:** {sequence_type}
**Emails:** {count}
**Goal:** {sell / nurture / onboard / recover}
**Audience:** {audience}
**Narrative Arc:** {one-line arc description}

---

### Email 1: {Title}
**Send:** {timing — e.g., Immediately, Day 1}
**Subject A:** {subject line option 1}
**Subject B:** {subject line option 2}
**Preview:** {preview text}
**Purpose:** {purpose in the sequence}
**Open Loop:** {what loop is planted or resolved}

{Full email body}

P.S. {if applicable}

---

### Email 2: {Title}
...

---

### Sequence Map

| # | Title | Purpose | Emotion | Open Loop | CTA |
|---|-------|---------|---------|-----------|-----|

### Send Schedule
{Timing recommendations with rationale}

### Segmentation Triggers
{Behavioral triggers and branch recommendations}
```

---

## Veto Conditions

- NEVER write emails that can be read in any order for soap-opera sequences — serialization is mandatory
- NEVER send a selling email before at least 2 value/story emails in nurture sequences
- NEVER write subject lines longer than 50 characters
- NEVER skip open loops in soap-opera sequences — they are the engine of engagement
- NEVER use the same emotional tone in consecutive emails

---

## Completion Criteria

- [ ] Sequence type framework correctly applied
- [ ] All emails written with dual subject lines
- [ ] Narrative arc builds tension across the sequence
- [ ] Open loops planted and resolved appropriately
- [ ] Each email follows one-email-one-idea rule
- [ ] Send timing recommendations provided
- [ ] Segmentation triggers suggested
- [ ] Consistent brand voice maintained throughout
