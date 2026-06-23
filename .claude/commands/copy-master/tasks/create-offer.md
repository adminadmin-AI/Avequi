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
  - "[ ] Hormozi Value Equation applied"
  - "[ ] Psychological Layer applied (Cialdini/Warren principles tagged)"
---

# Task: Create Offer

**Task ID:** COPY-M-007
**Version:** 2.0.0
**Command:** `*create-offer`
**Agent:** Dan Kennedy (dan-kennedy), Russell Brunson (russell-brunson), or Alex Hormozi (alex-hormozi)
**Purpose:** Architect an irresistible offer that maximizes perceived value and eliminates buying resistance, validated against the Hormozi Value Equation.

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

## Champion Reference

Study these real-world champion offers before writing:

1. **"$100M Offers" Grand Slam Framework** (Alex Hormozi) — Value Equation: Dream Outcome x Perceived Likelihood / Time Delay x Effort & Sacrifice
2. **Columbia House "12 CDs for 1 Penny"** — The original irresistible offer: massive perceived value, zero risk, subscription backend
3. **Domino's "30 Minutes or It's Free"** — Guarantee AS the offer, removed the #1 objection (speed), built an empire
4. **ClickFunnels "Free Book + Shipping"** (Russell Brunson) — Tripwire offer that acquires customers at profit, leads to $297-$2497 backend
5. **Dan Kennedy's "Magnetic Marketing" Kit** — Physical kit offer with perceived high value, self-liquidating front-end for high-ticket backend

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

### Phase 2: Hormozi Value Equation
1. Score the offer on all 4 dimensions of the Value Equation:
   - **Dream Outcome (maximize):** How desirable is the end result? (1-10)
   - **Perceived Likelihood of Achievement (maximize):** How likely do they believe they'll get it? (1-10)
   - **Time Delay (minimize):** How long until they see results? (1-10, lower is better)
   - **Effort & Sacrifice (minimize):** How much work/pain is required? (1-10, lower is better)
2. Formula: Value = (Dream Outcome x Perceived Likelihood) / (Time Delay x Effort & Sacrifice)
3. Identify which dimension is weakest and engineer the offer to improve it:
   - Low likelihood? Add proof, guarantee, case studies
   - High time delay? Add quick-start bonuses, fast-action elements
   - High effort? Add done-for-you components, templates, shortcuts
4. Re-score after offer construction to verify improvement

### Phase 3: Psychological Layer
1. Map Cialdini's principles into the offer structure:
   - **Reciprocity:** Bonus stack gives more than what's expected
   - **Commitment:** Graduated pricing or payment plans (small yes -> big yes)
   - **Social Proof:** "X people already bought" or testimonials in the stack
   - **Authority:** Expert endorsements or credentialing of the offer creator
   - **Scarcity:** Limited bonuses, early-bird pricing, enrollment caps
   - **Unity:** "This is for [identity group] only"
2. Apply Blair Warren's levers:
   - Encourage dreams: The transformation paints an irresistible future
   - Justify failures: Past solutions failed because they lacked X component (which this offers)
   - Allay fears: Guarantee removes ALL risk from the buyer
   - Confirm suspicions: "You always knew the secret was simpler than they made it"
3. Ensure the guarantee activates both Cialdini (risk reversal) and Warren (allay fears)

### Phase 4: Offer Construction
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

### Phase 5: Offer Positioning
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

**Core Transformation:** {before} -> {after}
**Price:** {price}
**Total Perceived Value:** {value}
**Value-to-Price Ratio:** {X}:1
**Guarantee:** {type + window}

### Hormozi Value Equation Score
| Dimension | Score (1-10) | Notes |
|-----------|-------------|-------|
| Dream Outcome | X | {note} |
| Perceived Likelihood | X | {note} |
| Time Delay (lower=better) | X | {note} |
| Effort & Sacrifice (lower=better) | X | {note} |
| **Value Score** | **{calculated}** | |

### Persuasion Architecture
| Offer Element | Cialdini Principles | Warren Levers |
|--------------|--------------------|--------------  |
| Core Offer | {principles} | {levers} |
| Bonuses | {principles} | {levers} |
| Guarantee | {principles} | {levers} |
| Scarcity | {principles} | {levers} |
| Price Reveal | {principles} | {levers} |

---

### Core Offer
{Description of what they get — the main product/service}

### Bonus Stack

| # | Bonus Name | What It Does | Value | Hormozi Dimension Improved |
|---|------------|-------------|-------|---------------------------|
| 1 | {name} | {solves X} | ${value} | {likelihood / time / effort} |
| 2 | {name} | {accelerates Y} | ${value} | {likelihood / time / effort} |
| 3 | {name} | {removes Z friction} | ${value} | {likelihood / time / effort} |

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
| Objection | How the Offer Addresses It | Psychology Used |
|-----------|---------------------------|-----------------|
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
- [ ] Hormozi Value Equation scored with all 4 dimensions
- [ ] 3-5 relevant bonuses designed and valued
- [ ] Each bonus mapped to a Hormozi dimension it improves
- [ ] Guarantee crafted as a selling point
- [ ] Urgency/scarcity element defined
- [ ] Price anchoring strategy complete
- [ ] Offer stack copy ready for use
- [ ] Objection handlers embedded in offer structure
- [ ] Psychological Layer applied — Cialdini principles mapped per element
- [ ] Blair Warren levers activated across offer
