---
task: auditAdAccount()
responsavel: "@ads-analyst"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: platform
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: account_data
    tipo: object
    origem: User Input
    obrigatorio: true

Saida:
  - campo: adAccountAudit
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] 8-dimension health scorecard completed"
  - "[ ] All campaigns categorized by performance tier"
  - "[ ] 5 prioritized recommendations with projected impact"
---

# Task: Audit Ad Account

**Task ID:** TRAFFIC-002
**Version:** 1.0.0
**Command:** `*audit-ad-account`
**Agent:** Ads Analyst (ads-analyst) or Performance Analyst (performance-analyst)
**Purpose:** Comprehensive audit of an advertising account to identify waste, opportunities, and optimization priorities.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| platform | enum | User prompt | Yes | facebook, google, tiktok, linkedin, youtube |
| account_data | object | User prompt | Yes | Key metrics: spend, CPA, ROAS, CTR, CVR, impressions |
| time_period | string | User prompt | Yes | Audit window (last 30, 60, or 90 days) |
| business_type | string | User prompt | No | Industry context for benchmarking |
| goals | string | User prompt | No | Business objectives and targets |
| num_campaigns | number | User prompt | No | Number of active campaigns |

---

## Preconditions

- Account data available with at least 30 days of history
- Access to campaign-level metrics (not just account-level)
- Business goals defined for context

---

## Execution Phases

### Phase 1: Account Health Check
1. Score the account on 8 dimensions (1-10 each):
   - Structure: Campaign/ad set/ad organization and naming conventions
   - Targeting: Audience quality, overlap, and exhaustion levels
   - Creative: Ad variety, freshness, and performance distribution
   - Budget: Allocation efficiency across campaigns
   - Bidding: Strategy appropriateness and optimization
   - Tracking: Pixel/conversion setup accuracy
   - Funnel Alignment: Campaigns matched to funnel stages
   - Performance: Metrics vs platform benchmarks
2. Calculate account-level aggregate metrics
3. Compare against platform benchmarks for the industry

### Phase 2: Campaign-Level Analysis
1. Categorize campaigns by performance tier:
   - Winners: Above-target ROAS/CPA (scale these)
   - Performers: At-target metrics (optimize these)
   - Underperformers: Below-target, declining (fix or kill)
   - Zombies: Low spend, low volume, no clear purpose (kill these)
2. For each underperformer, diagnose the root cause:
   - Low CTR: Creative fatigue or targeting mismatch
   - High CTR but low CVR: Landing page or offer issue
   - High CVR but high CPA: Bid or budget issue
   - Low reach: Audience too narrow or budget too low
3. Calculate wasted spend on underperformers and zombies
4. Identify the top 3 revenue opportunities in the account

### Phase 3: Creative and Audience Analysis
1. Rank all active ads by ROAS and volume
2. Identify creative patterns in top performers:
   - Format (image, video, carousel)
   - Hook type (question, statement, shock, story)
   - Length (short vs long copy)
   - Visual style
3. Identify audience fatigue signals:
   - Frequency above 3 in prospecting campaigns
   - Declining CTR over time in same audiences
   - Rising CPA trend in retargeting
4. Assess audience overlap between ad sets

### Phase 4: Recommendations
1. Prioritize findings by revenue impact (high, medium, low)
2. Provide 5 specific, actionable recommendations:
   - Kill List: What to turn off immediately
   - Scale List: What to increase budget on
   - Fix List: What to optimize (and how)
   - Test List: What new tests to run
   - Build List: What is missing from the account
3. Calculate projected impact of implementing recommendations
4. Create a 2-week optimization roadmap

---

## Output Format

```markdown
## Ad Account Audit: {Platform}

**Period:** {time_period}
**Total Spend:** ${X}
**Overall ROAS:** {X}:1
**Account Health Score:** {X}/80
**Wasted Spend:** ${X} ({Y}%)

---

### Account Health Scorecard

| Dimension | Score | Status | Key Issue |
|-----------|-------|--------|-----------|
| Structure | X/10 | {OK/Fix} | {note} |
| Targeting | X/10 | {OK/Fix} | {note} |
| Creative | X/10 | {OK/Fix} | {note} |
| Budget | X/10 | {OK/Fix} | {note} |
| Bidding | X/10 | {OK/Fix} | {note} |
| Tracking | X/10 | {OK/Fix} | {note} |
| Funnel Alignment | X/10 | {OK/Fix} | {note} |
| Performance | X/10 | {OK/Fix} | {note} |

### Campaign Performance Tiers

| Tier | Campaigns | Spend | ROAS | Action |
|------|-----------|-------|------|--------|
| Winners | {N} | ${X} | {X}:1 | Scale |
| Performers | {N} | ${X} | {X}:1 | Optimize |
| Underperformers | {N} | ${X} | {X}:1 | Fix/Kill |
| Zombies | {N} | ${X} | — | Kill |

### Top 5 Recommendations

| # | Action | Type | Projected Impact |
|---|--------|------|-----------------|
| 1 | {recommendation} | {kill/scale/fix/test/build} | +${X}/month |

### Kill List
{Campaigns/ad sets to turn off now}

### Scale List
{Campaigns to increase budget}

### 2-Week Optimization Roadmap
| Week | Day | Action | Expected Impact |
|------|-----|--------|----------------|
```

---

## Veto Conditions

- NEVER audit with less than 30 days of data — short windows produce unreliable conclusions
- NEVER recommend scaling without confirming tracking is accurate
- NEVER kill campaigns in learning phase — wait for statistical significance
- NEVER ignore zombie campaigns — they silently drain budget
- NEVER provide recommendations without estimated revenue impact

---

## Completion Criteria

- [ ] 8-dimension health scorecard completed
- [ ] All campaigns categorized by performance tier
- [ ] Wasted spend calculated
- [ ] Root causes diagnosed for underperformers
- [ ] 5 prioritized recommendations with projected impact
- [ ] Kill and scale lists provided
- [ ] 2-week optimization roadmap created
