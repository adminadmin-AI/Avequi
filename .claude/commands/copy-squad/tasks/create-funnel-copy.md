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
---

# Task: Create Funnel Copy

**Task ID:** COPY-009
**Version:** 1.0.0
**Command:** `*create-funnel-copy`
**Agent:** Russell Brunson (russell-brunson)
**Purpose:** Write copy for an entire funnel system — from opt-in through upsell.

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

## Execution Phases

### Phase 1: Funnel Architecture
1. Map the complete funnel flow with pages and emails:
   - **Lead Magnet Funnel:** Opt-in → Thank You → Nurture Emails → Sales Page
   - **Tripwire Funnel:** Opt-in → Tripwire Offer → OTO1 → OTO2 → Thank You
   - **Webinar Funnel:** Registration → Confirmation → Reminder Emails → Webinar → Replay → Sales
   - **Challenge Funnel:** Registration → Daily Emails → Daily Pages → Offer
   - **High-Ticket:** Application → VSL/Case Study → Call Booking → Follow-up
   - **Product Launch:** Pre-Launch Content → Cart Open → Mid-Cart → Cart Close
2. Define the "epiphany bridge" for each transition point
3. Map the value ladder progression through the funnel
4. Identify where each awareness level enters the funnel

### Phase 2: Write Page Copy
1. Write opt-in/registration page (see write-landing-page.md format)
2. Write confirmation/thank-you page with surprise and momentum
3. Write sales page or OTO pages:
   - Maintain continuity from previous page
   - Each page must stand alone if arrived at directly
   - OTO pages: short, direct, "wait — before you go" framing
4. Write downsell page (if applicable): reduced version, lower price
5. Write thank-you/access page: confirm purchase, set expectations, reduce buyer remorse

### Phase 3: Write Funnel Emails
1. Write confirmation email (immediate delivery)
2. Write nurture/bridge emails between pages (see write-email-sequence.md format)
3. Write cart abandonment emails (if e-commerce funnel)
4. Write post-purchase onboarding emails
5. Ensure email and page copy are consistent in voice and promise

### Phase 4: Funnel Optimization Notes
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
**Value Ladder:** {front-end} → {OTO1} → {OTO2}
**Target Revenue per Lead:** ${X}

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
