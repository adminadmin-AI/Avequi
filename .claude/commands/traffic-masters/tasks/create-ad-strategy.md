---
task: createAdStrategy()
responsavel: "@traffic-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: platform
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: adStrategy
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] 3-5 audience segments defined with targeting details"
  - "[ ] Campaign structure mapped by funnel stage"
  - "[ ] Budget allocated with daily and monthly breakdowns"
---

# Task: Create Ad Strategy

**Task ID:** TRAFFIC-001
**Version:** 1.0.0
**Command:** `*create-ad-strategy`
**Agent:** Traffic Chief (traffic-chief) routes to platform expert
**Purpose:** Design a platform-specific paid advertising strategy with targeting, creative direction, and budget allocation.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Product or service to advertise |
| audience | string | User prompt | Yes | Target audience demographics and psychographics |
| platform | enum | User prompt | Yes | facebook, google, youtube, tiktok, linkedin, multi-platform |
| budget | number | User prompt | Yes | Monthly advertising budget |
| objective | enum | User prompt | Yes | awareness, traffic, leads, sales, app-installs |
| funnel | string | User prompt | No | Landing page or funnel URL/description |
| current_performance | object | User prompt | No | Existing metrics if running ads already |

---

## Preconditions

- Budget defined with clear monthly allocation
- Landing page or funnel exists (or is being built)
- Platform selected based on where the audience spends time

---

## Execution Phases

### Phase 1: Audience Architecture
1. Define the primary audience segments (3-5 segments):
   - Demographics: age, gender, location, income
   - Psychographics: interests, behaviors, pain points
   - Platform-specific targeting: custom audiences, lookalikes, interest stacks
2. Map each segment to a funnel stage:
   - Cold: Never heard of you (prospecting)
   - Warm: Engaged with content or visited site (retargeting)
   - Hot: Added to cart, viewed pricing, past buyers (remarketing)
3. Size each audience and estimate reach at the given budget
4. Prioritize segments by expected ROAS

### Phase 2: Campaign Architecture
1. Structure campaigns by objective and funnel stage:
   - Top of Funnel: Awareness/engagement campaigns (cold audiences)
   - Middle of Funnel: Consideration campaigns (warm audiences)
   - Bottom of Funnel: Conversion campaigns (hot audiences)
2. Define ad sets within each campaign:
   - Audience targeting per ad set
   - Budget allocation per ad set
   - Placement selection (feed, stories, search, display, in-stream)
3. Set bidding strategy per campaign:
   - Learning phase considerations
   - Bid caps vs automatic bidding
   - Minimum budget per ad set for statistical significance

### Phase 3: Creative Strategy
1. Define creative themes per funnel stage:
   - TOF: Problem awareness, curiosity, entertainment
   - MOF: Proof, education, differentiation
   - BOF: Offer, urgency, testimonials
2. Specify ad formats per platform:
   - Facebook/IG: Static image, carousel, video (15s, 30s, 60s), collection
   - Google: Search (RSA), Display, Performance Max, YouTube
   - TikTok: UGC-style video, spark ads, branded effects
   - LinkedIn: Single image, carousel, video, conversation ads
3. Provide creative briefs for the first 3-5 ads per stage
4. Define the testing framework: which variables to test first

### Phase 4: Budget and KPI Framework
1. Allocate budget across funnel stages:
   - Suggested split: 60% TOF, 25% MOF, 15% BOF (adjust based on maturity)
2. Set KPI targets per stage using platform benchmarks
3. Define the optimization schedule:
   - Day 1-3: Let campaigns learn, do not touch
   - Day 4-7: Kill underperformers, scale winners
   - Weekly: Creative refresh, audience expansion
   - Monthly: Full strategy review
4. Create the scaling plan: triggers and methods for increasing spend

---

## Output Format

```markdown
## Ad Strategy: {Product Name}

**Platform:** {platform}
**Monthly Budget:** ${budget}
**Objective:** {objective}
**Estimated ROAS:** {X}:1

---

### Audience Segments

| Segment | Type | Size | Targeting | Funnel Stage |
|---------|------|------|-----------|-------------|

### Campaign Structure

| Campaign | Objective | Audience | Daily Budget | Placements |
|----------|----------|----------|-------------|------------|

### Creative Strategy

| Stage | Format | Theme | Hook Angle | CTA |
|-------|--------|-------|-----------|-----|

### Creative Briefs
{3-5 ad creative briefs with copy direction and visual notes}

### Budget Allocation

| Stage | % Budget | Monthly | Target CPA/ROAS |
|-------|---------|---------|----------------|

### KPI Targets

| Metric | TOF | MOF | BOF |
|--------|-----|-----|-----|

### Optimization Schedule
| Timeframe | Action | Criteria |
|-----------|--------|----------|

### Scaling Plan
| Trigger | Method | Budget Increase |
|---------|--------|----------------|
```

---

## Veto Conditions

- NEVER launch campaigns without a learning phase plan — killing ads too early wastes budget
- NEVER allocate 100% budget to BOF — you will exhaust warm audiences in days
- NEVER skip audience sizing — spending on audiences too small causes frequency fatigue
- NEVER recommend a platform where the target audience is not active
- NEVER set KPI targets without referencing platform benchmarks

---

## Completion Criteria

- [ ] 3-5 audience segments defined with targeting details
- [ ] Campaign structure mapped by funnel stage
- [ ] Creative strategy defined per stage with briefs
- [ ] Budget allocated with daily and monthly breakdowns
- [ ] KPI targets set per funnel stage
- [ ] Optimization schedule documented
- [ ] Scaling plan defined with triggers
