---
task: analyzePerformance()
responsavel: "@performance-analyst"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: platform
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: metrics
    tipo: object
    origem: User Input
    obrigatorio: true

Saida:
  - campo: performanceAnalysis
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Core metrics calculated and presented"
  - "[ ] 80/20 analysis performed"
  - "[ ] 7-day action plan created"
---

# Task: Analyze Performance

**Task ID:** TRAFFIC-006
**Version:** 1.0.0
**Command:** `*analyze-performance`
**Agent:** Performance Analyst (performance-analyst)
**Purpose:** Deep performance analysis of ad campaigns with data-driven recommendations.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| platform | enum | User prompt | Yes | facebook, google, youtube, tiktok, linkedin, multi |
| metrics | object | User prompt | Yes | Campaign metrics: spend, impressions, clicks, conversions, revenue |
| time_period | string | User prompt | Yes | Analysis window (7d, 14d, 30d, 90d) |
| comparison_period | string | User prompt | No | Previous period for trend analysis |
| breakdown | string | User prompt | No | Requested breakdown: campaign, ad-set, ad, audience, placement |
| business_context | string | User prompt | No | Seasonality, promotions, or external factors |

---

## Preconditions

- Minimum 7 days of data for meaningful analysis
- Conversion tracking verified and accurate
- At least one clear business KPI defined (CPA, ROAS, CPL)

---

## Execution Phases

### Phase 1: Metric Computation
1. Calculate core metrics from raw data:
   - CPC (Cost Per Click) = Spend / Clicks
   - CTR (Click-Through Rate) = Clicks / Impressions
   - CVR (Conversion Rate) = Conversions / Clicks
   - CPA (Cost Per Acquisition) = Spend / Conversions
   - ROAS (Return on Ad Spend) = Revenue / Spend
   - CPM (Cost Per 1000 Impressions) = (Spend / Impressions) x 1000
   - Frequency = Impressions / Reach
2. Calculate period-over-period changes if comparison data available
3. Identify statistically significant changes vs normal variance
4. Flag anomalies (sudden spikes or drops)

### Phase 2: Performance Breakdown
1. Break down performance by the requested dimension:
   - By Campaign: Which campaigns drive the most value?
   - By Ad Set: Which audiences convert best?
   - By Ad: Which creatives perform?
   - By Placement: Where does the ad work best?
   - By Day/Hour: When is performance strongest?
2. Apply the 80/20 analysis: which 20% of elements drive 80% of results?
3. Identify the bottom 20% dragging down performance
4. Calculate the impact of removing underperformers

### Phase 3: Trend Analysis
1. Chart the key metrics over the analysis period:
   - CPA trend: stable, rising, or declining?
   - ROAS trend: improving or degrading?
   - CTR trend: creative fatigue signal?
   - Frequency trend: audience exhaustion?
2. Identify inflection points — when did performance change?
3. Correlate changes with known events (creative launches, budget changes, external factors)
4. Project forward: where will these trends go in the next 14-30 days?

### Phase 4: Actionable Insights
1. Summarize the 3 most important findings
2. For each finding, provide:
   - What happened (data-backed observation)
   - Why it matters (business impact)
   - What to do about it (specific action)
3. Prioritize actions by expected impact
4. Create a 7-day action plan
5. Define what to monitor for the next analysis period

---

## Output Format

```markdown
## Performance Analysis: {Platform/Campaign}

**Period:** {dates}
**Total Spend:** ${X}
**Total Revenue:** ${X}
**ROAS:** {X}:1
**CPA:** ${X}
**Trend:** {improving / stable / declining}

---

### Key Metrics Summary

| Metric | Current | Previous | Change | Status |
|--------|---------|----------|--------|--------|
| Spend | ${X} | ${X} | {+/-X%} | {OK/Watch/Alert} |
| Revenue | ${X} | ${X} | {+/-X%} | {OK/Watch/Alert} |
| ROAS | {X}:1 | {X}:1 | {+/-X%} | {OK/Watch/Alert} |
| CPA | ${X} | ${X} | {+/-X%} | {OK/Watch/Alert} |
| CTR | {X}% | {X}% | {+/-X%} | {OK/Watch/Alert} |
| CVR | {X}% | {X}% | {+/-X%} | {OK/Watch/Alert} |

### 80/20 Analysis
**Top 20% drivers:** {list with metrics}
**Bottom 20% drags:** {list with metrics}
**Impact of cutting bottom 20%:** +${X} saved, ROAS improves to {X}:1

### Trend Analysis
{Trend descriptions with inflection points and projections}

### Top 3 Insights

#### Insight 1: {Title}
**What:** {observation}
**Why it matters:** {impact}
**Action:** {recommendation}

#### Insight 2-3: ...

### 7-Day Action Plan
| Day | Action | Expected Impact |
|-----|--------|----------------|

### Monitor Next Period
| Metric | Watch For | Threshold |
|--------|-----------|-----------|
```

---

## Veto Conditions

- NEVER analyze fewer than 7 days of data — short windows are noise, not signal
- NEVER present metrics without context (benchmarks, trends, or comparison periods)
- NEVER draw conclusions from statistically insignificant data (low volume ad sets)
- NEVER provide insights without specific, actionable recommendations
- NEVER ignore external factors (seasonality, promotions, market events)

---

## Completion Criteria

- [ ] Core metrics calculated and presented
- [ ] Period-over-period comparison completed (if data available)
- [ ] 80/20 analysis performed
- [ ] Trend analysis with inflection points
- [ ] Top 3 insights with data-backed observations
- [ ] 7-day action plan created
- [ ] Monitoring framework for next period defined
