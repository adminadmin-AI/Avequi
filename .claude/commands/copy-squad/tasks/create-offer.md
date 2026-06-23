---
task: createOffer()
responsavel: "@dan-kennedy"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: audience
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: offer_architecture
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Core transformation and value stack defined"
  - "[ ] 3-5 relevant bonuses designed with guarantee"
  - "[ ] Price anchoring strategy and offer stack copy ready"
---

# Task: Create Offer

**Task ID:** COPY-007
**Version:** 1.0.0
**Command:** `*create-offer`
**Agent:** Dan Kennedy (dan-kennedy) or Russell Brunson (russell-brunson)
**Purpose:** Architect an irresistible offer that maximizes perceived value and eliminates buying resistance.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Core product or service |
| audience | string | User prompt | Yes | Target buyer with budget context |
| price_range | string | User prompt | No | Acceptable price range or target price |
| delivery_method | string | User prompt | No | Digital, physical, service, hybrid |
| competitors | list | User prompt | No | Competing offers in the market |
| existing_assets | list | User prompt | No | Bonuses, content, tools already available |
| business_model | string | User prompt | No | One-time, subscription, high-ticket, low-ticket |

---

## Preconditions

- Core product or service defined with clear transformation it delivers
- Target audience identified with willingness-to-pay context

---

## Execution Phases

### Phase 1: Value Architecture
1. Define the core transformation (before state to after state)
2. Identify all value components the product delivers:
   - Primary outcome (the main thing they buy)
   - Secondary outcomes (bonus transformations)
   - Speed of result (time compression value)
   - Effort reduction (ease value)
   - Risk reduction (safety value)
3. Calculate the "dream outcome value" — what would they pay if guaranteed?
4. Map the value stack from most to least impactful

### Phase 2: Offer Construction
1. Structure the core offer with clear deliverables
2. Design the bonus stack (3-5 bonuses):
   - Each bonus must solve a related problem or accelerate the result
   - Assign individual dollar values to each bonus
   - Order bonuses by perceived value (highest first)
3. Craft the guarantee:
   - Choose type: money-back, results-based, conditional, unconditional
   - Make the guarantee bold enough to be a selling point on its own
   - Define the guarantee window and conditions
4. Build the urgency/scarcity element:
   - Choose type: time-limited, quantity-limited, bonus-limited, price-increase
   - Ensure the scarcity is real or believable
5. Set the price using anchoring:
   - Establish the "should be" price (total value of everything)
   - Show the "could be" price (discount from total)
   - Reveal the actual price as a fraction of perceived value

### Phase 3: Offer Positioning
1. Write the offer stack copy (how it will be presented in sales materials)
2. Create the "what you get" summary section
3. Write the guarantee statement as standalone copy
4. Develop the price justification narrative
5. Create objection-handling elements built into the offer structure
6. Define the exact CTA and what happens after they click/call

---

## Output Format

```markdown
## Offer Architecture: {Product Name}

**Core Transformation:** {before} → {after}
**Price:** {price}
**Total Perceived Value:** {value}
**Value-to-Price Ratio:** {X}:1
**Guarantee:** {type + window}

---

### Core Offer
{Description of what they get — the main product/service}

### Bonus Stack

| # | Bonus Name | What It Does | Value |
|---|------------|-------------|-------|
| 1 | {name} | {solves X} | ${value} |
| 2 | {name} | {accelerates Y} | ${value} |
| 3 | {name} | {removes Z friction} | ${value} |

### Guarantee
{Full guarantee statement — bold, specific, risk-reversing}

### Urgency/Scarcity
{What creates time pressure — and why it's credible}

### Price Presentation
- Total Value: ${total}
- Not ${high_anchor}
- Not even ${mid_anchor}
- Today: ${actual_price}
- {Payment plan option if applicable}

### Offer Stack Copy
{Ready-to-use copy block for sales page/VSL/email}

### Objection Handlers Built Into Offer
| Objection | How the Offer Addresses It |
|-----------|---------------------------|
```

---

## Veto Conditions

- NEVER create an offer without a guarantee — no guarantee means you are asking the buyer to carry all risk
- NEVER add bonuses unrelated to the core transformation
- NEVER use fake scarcity — it must be real or at minimum believable
- NEVER price without anchoring to perceived value first
- NEVER leave the CTA vague — specify exactly what happens next

---

## Completion Criteria

- [ ] Core transformation clearly defined
- [ ] Value stack mapped with individual values
- [ ] 3-5 relevant bonuses designed and valued
- [ ] Guarantee crafted as a selling point
- [ ] Urgency/scarcity element defined
- [ ] Price anchoring strategy complete
- [ ] Offer stack copy ready for use
- [ ] Objection handlers embedded in offer structure
