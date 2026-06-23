---
task: writeWebinarScript()
responsavel: "@russell-brunson"
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
  - campo: webinar_script
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Perfect Webinar framework fully executed (all 5 sections)"
  - "[ ] 3 Secrets structure with belief-breaking epiphany bridges"
  - "[ ] Stack and close sequence complete with price anchoring"
  - "[ ] Psychological Layer applied (Cialdini/Warren principles tagged)"
---

# Task: Write Webinar Script

**Task ID:** COPY-M-012
**Version:** 2.0.0
**Command:** `*write-webinar-script`
**Agent:** Russell Brunson (russell-brunson)
**Purpose:** Write a complete webinar script using the Perfect Webinar framework with layered persuasion psychology.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Product/service with core transformation |
| audience | string | User prompt | Yes | Target attendee profile with current beliefs and objections |
| offer | object | User prompt | Yes | Price, guarantee, bonuses, urgency elements |
| webinar_type | enum | User prompt | No | live, automated, hybrid — defaults to live |
| duration_target | string | User prompt | No | 60min (standard), 90min (extended), 45min (condensed) — defaults to 60min |
| three_secrets | list | User prompt | No | Pre-defined secrets/myths to break, or agent will derive them |
| origin_story | string | User prompt | No | Speaker's personal origin story for the epiphany bridge |

---

## Preconditions

- Product transformation clearly defined (before/after state)
- Offer structure complete with price, guarantee, and bonus stack
- Speaker credibility elements available (credentials, results, story)
- At least 3 false beliefs the audience holds that must be broken

---

## Champion Reference

Study these real-world champion webinars before writing:

1. **"Funnel Hacking Secrets" Perfect Webinar** (Russell Brunson) — The definitive execution of the Perfect Webinar framework, sold ClickFunnels to millions
2. **"Expert Secrets" Webinar** (Russell Brunson) — Meta-webinar teaching the webinar framework while executing it, masterclass in framework demonstration
3. **Tony Robbins' UPW Enrollment Webinar** — Authority + social proof stacking, emotional peak-state selling, high-ticket close
4. **Amy Porterfield's "List Builder Society"** — Education-heavy webinar with soft transition to offer, trust-first approach for warm audiences
5. **Todd Brown's "E5 Method" Webinar** — Big Idea driven webinar, mechanism-heavy, sophisticated audience targeting

---

## Execution Phases

### Phase 1: Perfect Webinar Framework Setup

1. **Introduction (5 min):** Hook + credibility + promise of the session
   - Big promise: "By the end of this presentation, you'll know exactly how to..."
   - Speaker credibility: Quick authority positioning
   - Rules of the webinar: "Take notes, stay until the end for the special offer"
2. **The One Thing (5 min):** Define the single new opportunity
   - Not an improvement offer (better version of what they're doing)
   - A NEW opportunity (entirely different vehicle to their desired result)
   - Frame the shift: "The reason you haven't achieved X is not because of Y — it's because you need Z"
3. **The 3 Secrets (30 min):** Three belief-breaking segments
   - Secret 1: Break the VEHICLE belief (the method/approach)
   - Secret 2: Break the INTERNAL belief (their personal ability)
   - Secret 3: Break the EXTERNAL belief (outside circumstances)
   - Each secret follows the Epiphany Bridge Story structure
4. **The Stack (10 min):** Value stack and offer presentation
   - Present each component of the offer individually
   - Stack slide building total value visually
   - Price reveal with anchoring
   - Guarantee
   - Bonus stack with scarcity
5. **The Close (10 min):** Final push with urgency
   - "Two choices" close: change or stay the same
   - FAQ / objection handling
   - Final CTA with exact instructions
   - Countdown / scarcity reinforcement

### Phase 2: Epiphany Bridge Stories

For each of the 3 Secrets, construct an Epiphany Bridge Story:
1. **Backstory:** Set the scene — where were you before the discovery?
2. **Journey:** What happened that led to the discovery?
3. **New Opportunity Discovery:** The moment of epiphany
4. **Framework/Strategy:** The system that emerged from the discovery
5. **Achievement:** The results that followed
6. **Bridge:** Connect the epiphany to the audience's situation

### Phase 3: Psychological Layer

1. Map Cialdini's principles into the webinar structure:
   - **Introduction:** Authority (credentials), Social Proof (attendee count, results)
   - **The One Thing:** Commitment (ask for small agreements — "Does that make sense?")
   - **Secret 1:** Liking (personal story creates connection)
   - **Secret 2:** Unity (shared identity — "I was just like you")
   - **Secret 3:** Reciprocity (massive free value during the teaching)
   - **The Stack:** Scarcity (limited bonuses, price increase)
   - **The Close:** Consistency (they agreed with each secret, so the offer is the logical next step)
2. Apply Blair Warren's levers across the webinar:
   - Encourage dreams: Throughout, especially in future-pacing
   - Justify failures: Secret 1 (the old vehicle was wrong, not you)
   - Allay fears: Secret 2 (you CAN do this — here's proof)
   - Confirm suspicions: Secret 3 (you were right that X was holding you back)
   - Throw rocks at enemies: Throughout (the industry, the gurus, the old way)
3. Build micro-commitments throughout — "Type YES in the chat if..."
4. Ensure each transition between sections has an emotional peak

### Phase 4: Script Writing

1. Write the complete script section by section with speaker notes
2. Include slide direction cues in brackets: [SLIDE: ...]
3. Include audience interaction cues: [POLL: ...], [CHAT: ...], [Q&A: ...]
4. Write transition lines between sections to maintain momentum
5. Include timing markers for pacing
6. Write the Q&A handling guide with pre-loaded objection responses
7. Write the post-webinar follow-up email sequence outline (3-5 emails)

### Phase 5: Production Notes

1. Slide count and content summary per section
2. Key visual moments (charts, proof screenshots, stack slide)
3. Emotional arc map across the full webinar
4. Suggested replay strategy (deadline, scarcity messaging)
5. Metrics to track: attendance rate, engagement, offer click-through, conversion

---

## Output Format

```markdown
## Webinar Script: {Webinar Title}

**Framework:** Perfect Webinar (Brunson)
**Duration:** {X} minutes
**Audience:** {audience}
**The One Thing:** {new opportunity statement}
**Offer:** {offer summary}

### Persuasion Architecture
| Section | Duration | Cialdini Principles | Warren Levers |
|---------|----------|--------------------|--------------  |
| Introduction | 5 min | {principles} | {levers} |
| The One Thing | 5 min | {principles} | {levers} |
| Secret 1 | 10 min | {principles} | {levers} |
| Secret 2 | 10 min | {principles} | {levers} |
| Secret 3 | 10 min | {principles} | {levers} |
| The Stack | 10 min | {principles} | {levers} |
| The Close | 10 min | {principles} | {levers} |

---

### INTRODUCTION (0:00 - 5:00)
{Script with slide cues and speaker notes}
[SLIDE: Title + Speaker Credibility]

### THE ONE THING (5:00 - 10:00)
{New opportunity framing}
[SLIDE: Old Opportunity vs New Opportunity]

### SECRET 1: {Title} — Breaking the Vehicle Belief (10:00 - 20:00)
**False Belief:** {what they currently believe}
**Epiphany Bridge Story:** {story arc}
**New Belief:** {what they'll believe after}
{Full script}
[SLIDE: Secret 1 Visual]

### SECRET 2: {Title} — Breaking the Internal Belief (20:00 - 30:00)
**False Belief:** {what they believe about themselves}
**Epiphany Bridge Story:** {story arc}
**New Belief:** {what they'll believe after}
{Full script}
[SLIDE: Secret 2 Visual]

### SECRET 3: {Title} — Breaking the External Belief (30:00 - 40:00)
**False Belief:** {what they believe about external factors}
**Epiphany Bridge Story:** {story arc}
**New Belief:** {what they'll believe after}
{Full script}
[SLIDE: Secret 3 Visual]

### THE STACK (40:00 - 50:00)
{Value stack presentation with running total}
[SLIDE: Stack Slide — building value]
[SLIDE: Price Reveal]
[SLIDE: Guarantee]
[SLIDE: Bonus Stack]

### THE CLOSE (50:00 - 60:00)
{Two choices close + FAQ + final CTA}
[SLIDE: Two Paths — Change vs Same]
[SLIDE: CTA with URL/button]

---

### Post-Webinar Email Sequence (Outline)
| Email | Send | Subject | Purpose |
|-------|------|---------|---------|
| 1 | Immediately | Replay link | Recap + CTA |
| 2 | Day 2 | Testimonial | Social proof push |
| 3 | Day 3 | FAQ | Objection handling |
| 4 | Day 4 | Final chance | Scarcity close |

### Production Notes
- **Total slides:** {count}
- **Key interaction moments:** {list}
- **Emotional arc:** Curiosity -> Hope -> Belief -> Desire -> Urgency
- **Replay strategy:** {description}
- **Metrics to track:** {list}
```

---

## Veto Conditions

- NEVER skip the 3 Secrets structure — it is the core persuasion engine
- NEVER present the offer before breaking all 3 beliefs
- NEVER write a webinar without Epiphany Bridge stories — data alone does not convert
- NEVER close without a "two choices" frame — it creates psychological urgency
- NEVER skip the Stack slide — visual value accumulation is critical for price anchoring

---

## Completion Criteria

- [ ] Perfect Webinar framework fully executed (all 5 sections)
- [ ] The One Thing clearly defines a new opportunity (not improvement)
- [ ] 3 Secrets with distinct belief types (vehicle, internal, external)
- [ ] Each Secret has a complete Epiphany Bridge Story
- [ ] Stack slide builds total value before price reveal
- [ ] Close includes two choices frame, FAQ, and final CTA
- [ ] Slide direction cues included throughout
- [ ] Timing markers provided for pacing
- [ ] Post-webinar email sequence outlined
- [ ] Production notes with metrics
- [ ] Psychological Layer applied — Cialdini principles mapped per section
- [ ] Blair Warren levers activated across the webinar arc
