---
task: planFundraise()
responsavel: "@vision-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: company
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: round_target
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: fundraise_plan
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Readiness assessment completed (10 dimensions)"
  - "[ ] Investment thesis and narrative arc crafted"
  - "[ ] Investor target list built and tiered"
---

# Task: Plan Fundraise

**Task ID:** CLEVEL-005
**Version:** 1.0.0
**Command:** `*plan-fundraise`
**Agent:** Vision Chief (vision-chief) + CMO Architect (cmo-architect)
**Purpose:** Design a complete fundraising strategy from readiness assessment through pitch preparation

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `company` | User prompt | Yes | Company name, stage, and description |
| `financials` | User | Yes | Current revenue, burn rate, runway, unit economics |
| `round_target` | User | Yes | Target raise amount and round type (pre-seed, seed, A, B) |
| `traction` | User | Yes | Key traction metrics (users, revenue, growth rate) |
| `existing_investors` | User | No | Current cap table and investor relationships |
| `use_of_funds` | User | No | How the funds will be deployed |

## Preconditions

- Company exists with demonstrable traction (or clear plan for pre-seed)
- Financial data available (even if basic)
- Executive frameworks loaded (`data/executive-frameworks.yaml`)

## Execution Phases

### Phase 1: Assess Readiness (vision-chief)

1. Apply the **Fundraising Readiness Assessment** (10 dimensions):
   - **Product:** Is there a working product? MVP? Revenue?
   - **Market:** TAM/SAM/SOM defined? Market timing clear?
   - **Traction:** Growth rate? Retention? Revenue trajectory?
   - **Team:** Founders complementary? Key hires made?
   - **Unit Economics:** CAC, LTV, margins understood?
   - **Competitive Position:** Defensibility? Moat?
   - **Vision:** Clear 5-year vision? Believable path?
   - **Financials:** Clean books? Projections realistic?
   - **Legal:** Cap table clean? IP protected? No liabilities?
   - **Narrative:** Compelling story? Data supports claims?
2. Score each dimension 1-5 and calculate **readiness score** (out of 50)
   - 40+: Ready to raise
   - 30-39: Near-ready, address gaps first
   - 20-29: Significant prep needed
   - <20: Not ready, focus on business fundamentals
3. Identify **critical gaps** that would cause investor rejection
4. Create a **gap-closing plan** with timeline
5. Determine **optimal timing** for the raise

### Phase 2: Define Narrative (vision-chief)

1. Craft the **Investment Thesis** -- why this is a great investment:
   - The problem (big, growing, painful)
   - The solution (unique, defensible, scalable)
   - The market (large, timing is right)
   - The traction (proof it works)
   - The team (why these founders will win)
   - The ask (how much, what for, what happens next)
2. Define the **narrative arc** for the pitch:
   - Hook: One sentence that captures attention
   - Problem: Make the pain visceral and relatable
   - Solution: Show the "aha" moment
   - Traction: Let the numbers speak
   - Market: Paint the opportunity
   - Business model: Show how money flows
   - Team: Prove founder-market fit
   - Ask: Clear amount, clear use, clear milestones
3. Develop **key proof points** for each claim:
   - Customer testimonials
   - Growth charts
   - Unit economics breakdown
   - Competitive comparisons
4. Prepare **objection handling** for top 10 investor concerns
5. Create the **one-liner** that explains the company in 10 seconds

### Phase 3: Build Deck (cmo-architect)

1. Design the **pitch deck** (12-15 slides):
   - Slide 1: Title + one-liner
   - Slide 2: Problem
   - Slide 3: Solution
   - Slide 4: Product demo/screenshots
   - Slide 5: Traction and milestones
   - Slide 6: Market size (TAM/SAM/SOM)
   - Slide 7: Business model
   - Slide 8: Go-to-market strategy
   - Slide 9: Competitive landscape
   - Slide 10: Team
   - Slide 11: Financial projections (3-year)
   - Slide 12: The ask and use of funds
   - Slide 13: Vision / closing statement
2. Create supporting materials:
   - **Data room checklist** (financials, legal, metrics, contracts)
   - **Executive summary** (2-page PDF)
   - **Financial model** (3-year projections with assumptions)
3. Apply deck design principles:
   - One key message per slide
   - Data visualizations over text
   - Consistent visual language
   - Max 20 words per slide (excluding data)

### Phase 4: Target Investors and Pitch Prep (vision-chief + cmo-architect)

1. Build the **investor target list** (30-50 investors):
   - Tier 1 (dream): 10 investors (best fit, hardest to get)
   - Tier 2 (strong): 15 investors (good fit, realistic)
   - Tier 3 (backup): 15-25 investors (acceptable, accessible)
2. For each investor, research:
   - Investment thesis and stage preference
   - Recent investments (portfolio companies)
   - Partner to target (who focuses on your sector)
   - Warm intro path (who can connect you)
3. Create the **outreach sequence**:
   - Week 1-2: Tier 3 (practice pitches)
   - Week 3-4: Tier 2 (build momentum, collect term sheets)
   - Week 5-6: Tier 1 (leverage existing interest)
4. Prepare for **pitch execution**:
   - 3-minute pitch (quick version for intros)
   - 15-minute pitch (standard VC meeting)
   - 45-minute pitch (deep dive with Q&A)
   - Mock pitch sessions (at least 3 before real pitches)
5. Define **negotiation parameters**:
   - Valuation range (floor and ceiling)
   - Terms to accept, negotiate, or reject
   - Timeline pressure points
   - Walk-away conditions

## Output Format

```yaml
fundraise_plan:
  company: "{name}"
  round: "{pre-seed|seed|series-a|series-b}"
  target_raise: "{amount}"
  readiness:
    score: "{X/50}"
    status: "{ready|near-ready|prep-needed|not-ready}"
    critical_gaps: ["{gap1}", "{gap2}"]
  narrative:
    one_liner: "{10-second pitch}"
    investment_thesis: "{2-sentence summary}"
    hook: "{opening sentence}"
  deck:
    slides: {number}
    status: "{draft|review|final}"
  investor_pipeline:
    tier_1: {count: 0, warm_intros: 0}
    tier_2: {count: 0, warm_intros: 0}
    tier_3: {count: 0, warm_intros: 0}
  timeline:
    prep_weeks: {number}
    pitch_weeks: {number}
    close_target: "{date}"
  deliverables:
    - readiness-assessment.md
    - investment-narrative.md
    - pitch-deck.md
    - investor-target-list.md
    - data-room-checklist.md
    - financial-model-outline.md
```

## Veto Conditions

1. **NEVER pitch before assessing readiness** -- raising too early damages reputation with investors
2. **NEVER start with Tier 1 investors** -- practice on lower-stakes meetings first
3. **NEVER pitch without a clear use of funds** -- "growth" is not a use of funds
4. **NEVER inflate metrics or projections** -- investor due diligence will find the truth
5. **NEVER raise without understanding dilution** -- know exactly what you're giving up

## Completion Criteria

- [ ] Readiness assessment completed (10 dimensions scored)
- [ ] Critical gaps identified with gap-closing plan
- [ ] Investment thesis and narrative arc crafted
- [ ] One-liner, 3-minute, and 15-minute pitches prepared
- [ ] Pitch deck outlined (12-15 slides)
- [ ] Investor target list built (30-50, tiered)
- [ ] Outreach sequence planned
- [ ] Negotiation parameters defined
- [ ] Data room checklist created
- [ ] Output matches schema above
