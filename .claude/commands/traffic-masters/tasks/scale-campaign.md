---
task: scaleCampaign()
responsavel: "@scale-optimizer"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: platform
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: campaign_data
    tipo: object
    origem: User Input
    obrigatorio: true

Saida:
  - campo: scalingPlan
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Scalability assessment completed with risk ratings"
  - "[ ] Scaling method selected with rationale"
  - "[ ] Monitoring guardrails defined with thresholds"
---

# Task: Scale Campaign

**Task ID:** TRAFFIC-003
**Version:** 1.0.0
**Command:** `*scale-campaign`
**Agent:** Scale Optimizer (scale-optimizer) or Depesh Mandalia (depesh-mandalia)
**Purpose:** Scale winning campaigns profitably using the BPM (Budget, Performance, Metrics) method.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| platform | enum | User prompt | Yes | facebook, google, youtube, tiktok |
| campaign_data | object | User prompt | Yes | Current metrics: spend, CPA, ROAS, CTR, CVR, daily spend |
| target_spend | number | User prompt | Yes | Desired daily or monthly spend target |
| current_spend | number | User prompt | Yes | Current daily or monthly spend |
| max_cpa | number | User prompt | No | Maximum acceptable CPA |
| min_roas | number | User prompt | No | Minimum acceptable ROAS |
| timeline | string | User prompt | No | How fast to scale (aggressive, moderate, conservative) |

---

## Preconditions

- Campaign has proven performance at current spend level (minimum 7 days of data)
- Tracking is accurate and conversion events fire correctly
- Landing page can handle increased traffic volume

---

## Execution Phases

### Phase 1: Scalability Assessment
1. Evaluate the campaign's scaling readiness:
   - Is the audience large enough to support the target spend?
   - Is the creative showing fatigue signals (declining CTR)?
   - Is the CPA stable or trending upward?
   - What is the current frequency (above 2.5 is a warning)?
2. Calculate the scaling ceiling: audience size / (frequency cap x CPM) = max daily spend
3. Assess the creative depth: how many winning ads are active?
4. Check backend capacity: can the business handle 2x-5x the current lead/sale volume?

### Phase 2: Scaling Strategy Selection
1. Choose the scaling method based on the gap between current and target spend:
   - **Vertical Scaling (< 2x):** Increase budget on existing campaigns
     - 20% budget increase every 48-72 hours
     - Monitor for CPA spikes after each increase
     - Reset if CPA increases more than 30% for 48 hours
   - **Horizontal Scaling (2x-5x):** Duplicate to new audiences
     - Duplicate winning ad sets to new audience segments
     - Duplicate winning ads to new campaigns with different objectives
     - Test lookalike audiences at increasing percentages
   - **Diagonal Scaling (5x+):** Expand to new platforms and angles
     - Port winning creatives to new platforms
     - Test new creative angles against proven audiences
     - Build new funnels for new traffic temperature
2. Define the scaling schedule with budget milestones
3. Set kill criteria for each scaling phase

### Phase 3: Creative Scaling
1. Identify the creative elements that drive performance:
   - Which hooks perform best?
   - Which formats convert best?
   - Which audiences respond to which creatives?
2. Plan the creative iteration pipeline:
   - Variation 1: Same hook, different visual
   - Variation 2: Same visual, different hook
   - Variation 3: Same message, different format (image to video, etc.)
3. Set the creative refresh schedule:
   - Small audiences: New creative every 5-7 days
   - Large audiences: New creative every 14-21 days
4. Build a "creative bank" of 5-10 ads ready to deploy when fatigue hits

### Phase 4: Monitoring and Guardrails
1. Define daily monitoring metrics and thresholds:
   - CPA threshold: Max X% above target before pausing
   - ROAS threshold: Min X:1 before pausing
   - Frequency threshold: Max X before creative refresh
   - Spend pace: Expected daily spend variance tolerance
2. Create the escalation protocol:
   - CPA spike 20-30%: Reduce budget 20%, monitor 48h
   - CPA spike 30-50%: Pause, diagnose, fix before resuming
   - CPA spike 50%+: Kill ad set, launch new test
3. Set weekly review checkpoints with comparison to baseline
4. Define the "scaling success" milestone — when is the scale achieved?

---

## Output Format

```markdown
## Scaling Plan: {Campaign Name}

**Platform:** {platform}
**Current Spend:** ${X}/day
**Target Spend:** ${Y}/day
**Scale Factor:** {X}x
**Method:** {vertical / horizontal / diagonal}
**Timeline:** {X weeks}

---

### Scalability Assessment

| Factor | Status | Risk |
|--------|--------|------|
| Audience Size | {adequate/limited} | {low/med/high} |
| Creative Depth | {N winning ads} | {low/med/high} |
| CPA Stability | {stable/rising} | {low/med/high} |
| Frequency | {current} | {low/med/high} |
| Backend Capacity | {ready/concern} | {low/med/high} |

### Scaling Schedule

| Week | Daily Budget | Method | New Elements |
|------|-------------|--------|-------------|

### Creative Pipeline

| Priority | Creative | Format | Audience | Status |
|----------|---------|--------|----------|--------|

### Guardrails

| Metric | Threshold | Action if Breached |
|--------|-----------|-------------------|

### Kill Criteria
{When to stop scaling and reassess}

### Success Milestone
{Definition of scaling success}
```

---

## Veto Conditions

- NEVER scale a campaign with less than 7 days of stable data
- NEVER increase budget more than 20% in a single day (vertical scaling)
- NEVER scale without a creative pipeline ready — you will hit fatigue
- NEVER ignore frequency — scaling into fatigued audiences burns money
- NEVER scale if tracking is unreliable — you cannot optimize what you cannot measure

---

## Completion Criteria

- [ ] Scalability assessment completed with risk ratings
- [ ] Scaling method selected with rationale
- [ ] Budget schedule mapped week by week
- [ ] Creative pipeline built with 5-10 ready-to-deploy ads
- [ ] Monitoring guardrails defined with thresholds
- [ ] Kill criteria established
- [ ] Success milestone defined
