---
task: writeLandingPage()
responsavel: "@joe-sugarman"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: page_type
    tipo: enum
    origem: User Input
    obrigatorio: true

Saida:
  - campo: landing_page_copy
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Single conversion goal defined and maintained"
  - "[ ] All sections written per page type architecture"
  - "[ ] CTA appears at least 3 times with action-oriented text"
---

# Task: Write Landing Page Copy

**Task ID:** COPY-008
**Version:** 1.0.0
**Command:** `*write-landing-page`
**Agent:** Joe Sugarman (joe-sugarman)
**Purpose:** Write landing page copy that creates an unstoppable slippery slide from headline to CTA.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Product/service being offered |
| audience | string | User prompt | Yes | Target visitor profile |
| page_type | enum | User prompt | Yes | opt-in, sales, webinar-reg, waitlist, product, checkout |
| offer | object | User prompt | Yes | What the visitor gets for taking action |
| traffic_source | string | User prompt | No | Where visitors come from (ads, email, organic, social) |
| awareness_level | enum | User prompt | No | Awareness level of incoming traffic |
| page_length | string | User prompt | No | short (opt-in), medium (webinar), long (sales) — auto-detected from type |

---

## Preconditions

- Page type selected with clear conversion goal
- Offer defined (even for opt-in pages — what do they get?)
- Traffic source identified to calibrate awareness and messaging

---

## Execution Phases

### Phase 1: Page Strategy
1. Define the single conversion goal (one page, one action)
2. Identify the visitor's state of mind when they arrive:
   - From cold ad: skeptical, curious, low trust
   - From email: warm, somewhat trusting, expecting what was promised
   - From organic: research mode, comparing options
3. Map the "slippery slide" — every element must pull toward the CTA
4. Decide the page architecture based on type:
   - Opt-in: Headline → Benefit bullets → Form → CTA (short)
   - Sales: Full AIDA with proof sections (long)
   - Webinar reg: Headline → What you'll learn → Speaker cred → Date/Time → CTA (medium)

### Phase 2: Section-by-Section Writing
1. **Hero Section:** Headline + sub-headline + hero CTA
   - The headline must do 80% of the selling
   - Sub-headline clarifies or amplifies
   - Hero CTA for ready-to-act visitors
2. **Problem Section:** Agitate the current pain
   - Use "you" language — make it personal
   - 3-5 specific pain points the audience recognizes
3. **Solution Section:** Introduce the product/mechanism
   - Bridge from problem to solution naturally
   - Name the mechanism or methodology
4. **Benefits Section:** Stack benefits with specificity
   - Use icons or checkmarks for scannability
   - Each benefit answers "what's in it for me?"
5. **Proof Section:** Social proof and credibility
   - Testimonials, logos, stats, media mentions
   - Place strategically (not all in one block)
6. **Offer Section:** What they get (if sales page)
   - Stack the value with clear deliverables
   - Include bonuses, guarantee, price
7. **FAQ Section:** Handle remaining objections
   - 5-7 questions that address real hesitations
8. **Final CTA:** Last push with urgency

### Phase 3: Conversion Optimization
1. Ensure CTA appears at minimum 3 times on the page
2. Write all button text as action-oriented first person ("Get My Free Guide")
3. Add micro-copy below buttons to reduce anxiety
4. Review the page for "exit points" — anything that could lose the visitor
5. Add mobile-specific considerations (shorter paragraphs, larger CTA targets)

---

## Output Format

```markdown
## Landing Page Copy: {Page Name}

**Type:** {page_type}
**Goal:** {single conversion action}
**Traffic Source:** {source}
**Awareness Level:** {level}

---

### [HERO SECTION]
**Headline:** {headline}
**Sub-headline:** {sub-headline}
**CTA Button:** {button text}
**Micro-copy:** {below-button text}

### [PROBLEM SECTION]
{Problem agitation copy}

### [SOLUTION SECTION]
{Solution introduction copy}

### [BENEFITS SECTION]
{Benefits with formatting notes}

### [PROOF SECTION]
{Testimonial placeholders and social proof copy}

### [OFFER SECTION]
{Value stack and pricing — if sales page}

### [FAQ SECTION]
{5-7 Q&A pairs}

### [FINAL CTA SECTION]
{Closing argument + CTA}

---

### Conversion Notes
- **CTA count:** {X placements}
- **Estimated page length:** {scroll depth}
- **Key anxiety reducers:** {list}
- **Mobile considerations:** {list}
```

---

## Veto Conditions

- NEVER give the page more than one conversion goal
- NEVER write a landing page without a hero CTA above the fold
- NEVER use navigation links — the only clickable element should be the CTA
- NEVER write FAQ answers that introduce new objections
- NEVER ignore the traffic source — cold traffic pages are fundamentally different from warm

---

## Completion Criteria

- [ ] Single conversion goal defined and maintained throughout
- [ ] All sections written per page type architecture
- [ ] CTA appears at least 3 times
- [ ] Button text is action-oriented first person
- [ ] Proof elements strategically placed
- [ ] FAQ handles real objections
- [ ] Mobile considerations noted
- [ ] Slippery slide maintained — no exit points
