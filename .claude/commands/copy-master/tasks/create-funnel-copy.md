---
task: createFunnelCopy()
responsavel: "@russell-brunson"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: funnel_type
    tipo: enum
    origem: User Input
    obrigatorio: true

Saida:
  - campo: funnel_copy_system
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Funnel architecture mapped with all pages and emails"
  - "[ ] All page and email copy written per format standards"
  - "[ ] Funnel math calculated with expected conversion rates"
  - "[ ] Psychological Layer applied (Cialdini/Warren principles tagged)"
---

# Task: Create Funnel Copy

**Task ID:** COPY-M-009
**Version:** 2.0.0
**Command:** `*create-funnel-copy`
**Agent:** Russell Brunson (russell-brunson)
**Purpose:** Write copy for an entire funnel system — from opt-in through upsell — with persuasion psychology woven throughout.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Core product and product line |
| audience | string | User prompt | Yes | Target avatar with buying journey |
| funnel_type | enum | User prompt | Yes | lead-magnet, tripwire, webinar, challenge, high-ticket-application, product-launch |
| offer_stack | object | User prompt | Yes | Front-end offer, OTO1, OTO2, downsell if applicable |
| traffic_source | string | User prompt | No | Primary traffic channel |
| price_points | list | User prompt | No | Price at each funnel stage |

---

## Preconditions

- Funnel type selected with clear monetization strategy
- Offer stack defined with at least front-end and one upsell
- Product line supports the funnel architecture

---

## Champion Reference

Study these real-world champion funnels before writing:

1. **ClickFunnels "Free + Shipping" Book Funnel** (Russell Brunson) — Opt-in -> Tripwire book -> OTO course -> High-ticket coaching, the value ladder in action
2. **DigitalMarketer "Invisible Selling Machine"** (Ryan Deiss) — Tripwire funnel with automated email upsell ladder, textbook email-to-OTO flow
3. **Tai Lopez "67 Steps" Webinar Funnel** — Webinar reg -> Replay -> Core offer -> High-ticket upsell, scaled to 8 figures
4. **Jeff Walker's Product Launch Formula** — Pre-launch content -> Cart open -> Urgency sequence, pioneered the launch funnel model
5. **Agora Financial "Free Report" Funnel** — Free report opt-in -> Upsell newsletter -> Backend high-ticket advisory, longest-running DR funnel archetype

---

## Execution Phases

### Phase 1: Funnel Architecture
1. Map the complete funnel flow with pages and emails:
   - **Lead Magnet Funnel:** Opt-in -> Thank You -> Nurture Emails -> Sales Page
   - **Tripwire Funnel:** Opt-in -> Tripwire Offer -> OTO1 -> OTO2 -> Thank You
   - **Webinar Funnel:** Registration -> Confirmation -> Reminder Emails -> Webinar -> Replay -> Sales
   - **Challenge Funnel:** Registration -> Daily Emails -> Daily Pages -> Offer
   - **High-Ticket:** Application -> VSL/Case Study -> Call Booking -> Follow-up
   - **Product Launch:** Pre-Launch Content -> Cart Open -> Mid-Cart -> Cart Close
2. Define the "epiphany bridge" for each transition point
3. Map the value ladder progression through the funnel
4. Identify where each awareness level enters the funnel

### Phase 2: Psychological Layer
1. Map Cialdini's principles across funnel stages:
   - **Opt-in/Registration:** Reciprocity (free value for email)
   - **Thank You / Tripwire:** Commitment (small purchase builds consistency for larger ones)
   - **Nurture emails:** Liking (personal stories), Authority (credentials)
   - **Sales page / OTO:** Social Proof (testimonials, numbers), Scarcity (limited offer)
   - **Upsell pages:** Consistency (they already bought — this is the logical next step)
   - **Post-purchase:** Unity (welcome to the tribe)
2. Apply Blair Warren's levers at key transition points:
   - Opt-in: Encourage dreams (promise the transformation)
   - Tripwire: Allay fears (low risk, high value)
   - OTO: Confirm suspicions (you need this extra piece to succeed)
   - Cart close: Throw rocks at enemies (the old way that failed you)
3. Ensure each funnel page activates at least 2 distinct psychological principles

### Phase 3: Write Page Copy
1. Write opt-in/registration page (see write-landing-page.md format)
2. Write confirmation/thank-you page with surprise and momentum
3. Write sales page or OTO pages:
   - Maintain continuity from previous page
   - Each page must stand alone if arrived at directly
   - OTO pages: short, direct, "wait — before you go" framing
4. Write downsell page (if applicable): reduced version, lower price
5. Write thank-you/access page: confirm purchase, set expectations, reduce buyer remorse

### Phase 4: Write Funnel Emails
1. Write confirmation email (immediate delivery)
2. Write nurture/bridge emails between pages (see write-email-sequence.md format)
3. Write cart abandonment emails (if e-commerce funnel)
4. Write post-purchase onboarding emails
5. Ensure email and page copy are consistent in voice and promise

### Phase 5: Funnel Optimization Notes
1. Map the expected conversion rates at each stage
2. Identify the critical "leak points" where drop-off is likely
3. Provide A/B testing priorities for each funnel stage
4. Suggest retargeting copy for each stage abandonment
5. Calculate the funnel math (traffic needed for target revenue)

---

## Output Format

```markdown
## Funnel Copy System: {Funnel Name}

**Type:** {funnel_type}
**Stages:** {count}
**Value Ladder:** {front-end} -> {OTO1} -> {OTO2}
**Target Revenue per Lead:** ${X}

### Persuasion Architecture
| Funnel Stage | Cialdini Principles | Warren Levers |
|-------------|--------------------|--------------  |
| Opt-in | {principles} | {levers} |
| Tripwire/OTO | {principles} | {levers} |
| Sales Page | {principles} | {levers} |
| Post-Purchase | {principles} | {levers} |

---

### Funnel Map

{Visual text representation of funnel flow}

---

### Page 1: {Page Name}
**Type:** {opt-in / sales / OTO / thank-you}
**Goal:** {conversion action}
{Full page copy per landing page format}

---

### Page 2-N: ...

---

### Email Sequence: {Name}
{Emails per email sequence format}

---

### Funnel Math

| Stage | Expected CVR | Traffic Needed | Revenue |
|-------|-------------|----------------|---------|

### A/B Testing Priorities
| Priority | Stage | Element to Test | Hypothesis |
|----------|-------|----------------|------------|

### Retargeting Copy
{Copy for each abandonment stage}
```

---

## Veto Conditions

- NEVER build a funnel without a clear value ladder progression
- NEVER write OTO pages that contradict the front-end offer's promise
- NEVER skip the thank-you page — it prevents buyer remorse and sets up the next offer
- NEVER create a funnel with more than 2 upsells without user confirmation
- NEVER ignore the math — every funnel must have projected conversion rates

---

## Completion Criteria

- [ ] Funnel architecture mapped with all pages and emails
- [ ] All page copy written per landing page format
- [ ] All email sequences written per email format
- [ ] Funnel math calculated with expected conversion rates
- [ ] A/B testing priorities defined for each stage
- [ ] Retargeting copy provided for abandonment stages
- [ ] Voice and promise consistent across entire funnel
- [ ] Value ladder progression is logical and compelling
- [ ] Psychological Layer applied — Cialdini principles mapped per funnel stage
- [ ] Blair Warren levers activated at key transition points
