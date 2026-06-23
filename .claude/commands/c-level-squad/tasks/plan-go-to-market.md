---
task: planGoToMarket()
responsavel: "@cmo-architect"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: target_market
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: gtm_strategy
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] TAM/SAM/SOM defined with market timing"
  - "[ ] Positioning statement crafted with messaging hierarchy"
  - "[ ] Top 3 channels selected with strategy and budget"
---

# Task: Plan Go-to-Market

**Task ID:** CLEVEL-003
**Version:** 1.0.0
**Command:** `*plan-gtm`
**Agent:** CMO Architect (cmo-architect)
**Purpose:** Design a comprehensive go-to-market strategy covering market analysis, positioning, channel strategy, launch plan, and success metrics

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `product` | User prompt | Yes | Product or service to bring to market |
| `target_market` | User prompt | Yes | Target market and ideal customer profile |
| `competitive_landscape` | User | No | Known competitors and their positioning |
| `budget` | User | No | Marketing budget available |
| `timeline` | User | No | Launch date or time constraint |

## Preconditions

- Product or service is defined (at least MVP scope)
- Target market hypothesis exists
- Executive frameworks loaded (`data/executive-frameworks.yaml`)

## Execution Phases

### Phase 1: Market Analysis

1. Define the **Total Addressable Market (TAM)**:
   - TAM: Total market demand
   - SAM: Serviceable addressable market
   - SOM: Serviceable obtainable market (realistic first-year target)
2. Conduct **competitive analysis**:
   - Direct competitors (same solution, same audience)
   - Indirect competitors (different solution, same problem)
   - Alternative solutions (what customers do today without your product)
3. Apply **Blue Ocean Strategy** assessment:
   - What factors can we eliminate (industry takes for granted)?
   - What factors can we reduce (over-served by industry)?
   - What factors can we raise (under-served by industry)?
   - What factors can we create (industry has never offered)?
4. Identify the **market gap** -- unmet need or underserved segment
5. Assess **market timing** -- why now? What has changed?

### Phase 2: Positioning

1. Create the **Positioning Statement**:
   - For [target customer] who [need/problem], [product] is a [category] that [key benefit]. Unlike [alternative], we [differentiator].
2. Define the **Value Proposition Canvas**:
   - Customer jobs (what they're trying to do)
   - Customer pains (frustrations and risks)
   - Customer gains (desired outcomes)
   - Pain relievers (how we address pains)
   - Gain creators (how we create gains)
3. Develop **messaging hierarchy**:
   - Level 1: One-line pitch (10 seconds)
   - Level 2: Elevator pitch (30 seconds)
   - Level 3: Value story (2 minutes)
   - Level 4: Full narrative (5 minutes, presentation)
4. Define **proof points** -- evidence that supports each claim
5. Create the **competitive positioning map** (2x2 matrix with chosen axes)

### Phase 3: Channel Strategy

1. Map the **Customer Acquisition Journey**:
   - Awareness: How they first hear about us
   - Consideration: How they evaluate us
   - Decision: How they choose to buy
   - Onboarding: How they start using
   - Expansion: How they buy more
2. Evaluate channels using the **Bullseye Framework**:
   - Outer ring: All possible channels (brainstorm 19+ channels)
   - Middle ring: Promising channels (6-8 based on audience fit)
   - Inner ring: Core channels (top 3 to test first)
3. For each core channel, define:
   - **Strategy:** How we'll use this channel
   - **Tactics:** Specific campaigns and content
   - **Budget:** Allocation and expected CAC
   - **Timeline:** When to launch and ramp
   - **Success metrics:** Channel-specific KPIs
4. Design the **content marketing engine**:
   - Content pillars (3-5 themes)
   - Content types per funnel stage
   - Distribution plan
5. Define the **marketing-sales handoff** (MQL to SQL criteria)

### Phase 4: Launch Plan and Success Metrics

1. Create the **Launch Sequence** (T-minus timeline):
   - T-60 days: Pre-launch audience building, waitlist, beta
   - T-30 days: Content seeding, PR outreach, partner alignment
   - T-14 days: Teaser campaign, early access
   - T-7 days: Final prep, team alignment, systems check
   - Launch day: Coordinated push across all channels
   - T+7 days: Momentum maintenance, user feedback
   - T+30 days: Post-launch review and optimization
2. Define **launch metrics** (first 30 days):
   - Awareness: Reach, impressions, PR mentions
   - Acquisition: Signups, trials, demos
   - Activation: First value delivered
   - Revenue: First paying customers
3. Define **steady-state metrics** (ongoing):
   - CAC (Customer Acquisition Cost)
   - LTV/CAC ratio (target > 3:1)
   - Payback period
   - Marketing-sourced pipeline %
   - Channel-specific ROAS
4. Create the **90-day post-launch optimization plan**
5. Define **pivot triggers** -- signals that require strategy change

## Output Format

```yaml
gtm_strategy:
  product: "{name}"
  market:
    tam: "{size}"
    sam: "{size}"
    som: "{size}"
    timing: "{why now}"
  positioning:
    statement: "{positioning statement}"
    one_line_pitch: "{10-second pitch}"
    differentiator: "{key differentiator}"
  channels:
    core: ["{channel1}", "{channel2}", "{channel3}"]
    total_budget: "{amount}"
    target_cac: "{amount}"
  launch:
    date: "{date or TBD}"
    sequence_duration: "90 days (60 pre + 30 post)"
    key_milestones: ["{milestone1}", "{milestone2}"]
  success_metrics:
    30_day: {signups: "", revenue: "", activation: ""}
    ltv_cac_target: "> 3:1"
  deliverables:
    - market-analysis.md
    - positioning-document.md
    - channel-strategy.md
    - launch-plan.md
    - metrics-dashboard.md
```

## Veto Conditions

1. **NEVER launch without a positioning statement** -- undifferentiated products die in market
2. **NEVER spread budget across more than 3 core channels initially** -- focus beats breadth at launch
3. **NEVER skip the Blue Ocean assessment** -- competing head-on with incumbents on their terms is suicide
4. **NEVER define success metrics after launch** -- if you don't know what success looks like, you can't measure it
5. **NEVER ignore the marketing-sales handoff** -- MQL to SQL misalignment wastes both teams' time

## Completion Criteria

- [ ] TAM/SAM/SOM defined with market timing rationale
- [ ] Competitive analysis completed (direct, indirect, alternatives)
- [ ] Positioning statement crafted with messaging hierarchy
- [ ] Top 3 channels selected with strategy and budget
- [ ] Launch sequence planned (T-60 to T+30)
- [ ] Success metrics defined for 30-day and steady-state
- [ ] LTV/CAC target and payback period projected
- [ ] Output matches schema above
