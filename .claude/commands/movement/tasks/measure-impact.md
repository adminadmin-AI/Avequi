---
task: measureImpact()
responsavel: "@analista-de-impacto"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: movement_context
    tipo: string
    origem: Session
    obrigatorio: true
  - campo: goals
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: impact_framework
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Impact Pyramid defined with 5 levels"
  - "[ ] Vitality Index formula defined with weights"
  - "[ ] Reporting cadence established"
---

# Task: Measure Impact

**Task ID:** MOVEMENT-005
**Version:** 1.0.0
**Command:** `*measure-impact`
**Agent:** Analista de Impacto (analista-de-impacto)
**Purpose:** Design and implement a comprehensive impact measurement framework with metrics, dashboards, and vitality scoring

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `movement_context` | Session | Yes | Movement cause, identity, and growth strategy |
| `growth_data` | estrategista-de-ciclo | No | Existing growth metrics and community data |
| `goals` | User prompt | Yes | What impact the movement aims to achieve |
| `timeframe` | User | No | Measurement period: monthly, quarterly, annual |
| `existing_metrics` | User | No | Any metrics already being tracked |

## Preconditions

- Movement identity defined (at minimum, core beliefs and audience)
- Growth strategy exists or is in progress
- Movement frameworks loaded (`data/movement-frameworks.yaml`)

## Execution Phases

### Phase 1: Define Impact Pyramid

1. Map the 5 levels of the Impact Pyramid:
   - **Level 1 -- Awareness:** People know the movement exists
   - **Level 2 -- Engagement:** People interact with the movement
   - **Level 3 -- Commitment:** People identify as members
   - **Level 4 -- Advocacy:** Members recruit others
   - **Level 5 -- Transformation:** Real-world change occurs
2. For each level, define what "success" looks like for this specific movement
3. Identify the **current level** -- where is the movement today
4. Set **target level** for the next cycle
5. Map dependencies between levels

### Phase 2: Set Metrics Per Level

1. For each pyramid level, define:
   - **Leading indicators** -- predictive signals
   - **Lagging indicators** -- confirmed outcomes
   - **Qualitative markers** -- narrative evidence
2. Select **3-5 metrics per level** (no more, to avoid metric overload)
3. Define measurement methods for each metric
4. Set baselines and targets
5. Create the **metrics matrix** -- level x metric x method x target

### Phase 3: Measure Community Health

1. Design the **Community Health Dashboard** with 6 dimensions:
   - **Growth rate** -- new members per period
   - **Activation rate** -- % of new members who engage within 7 days
   - **Retention rate** -- % still active after 30/60/90 days
   - **Engagement depth** -- average interactions per active member
   - **Sentiment score** -- positive/negative/neutral sentiment ratio
   - **Advocacy rate** -- % of members who recruit others
2. Define data collection methods for each dimension
3. Set healthy ranges for each dimension (green/yellow/red)
4. Design the **weekly pulse** report template
5. Design the **monthly deep-dive** report template

### Phase 4: Calculate Vitality Index

1. Define the **Vitality Index** formula:
   - Weighted composite of the 6 health dimensions
   - Default weights: Growth (15%), Activation (20%), Retention (25%), Engagement (20%), Sentiment (10%), Advocacy (10%)
   - Scale: 0-100
2. Set **vitality thresholds**:
   - 80-100: Thriving -- maintain and optimize
   - 60-79: Healthy -- minor adjustments needed
   - 40-59: At Risk -- intervention required
   - 20-39: Critical -- major pivot needed
   - 0-19: Failing -- existential review required
3. Create the **reporting cadence**:
   - Weekly: Vitality Index pulse + top 3 leading indicators
   - Monthly: Full dashboard + trend analysis + recommendations
   - Quarterly: Impact pyramid review + strategy adjustment
4. Define **alert triggers** -- when to escalate to movement-chief

## Output Format

```yaml
impact_framework:
  movement: "{name}"
  current_pyramid_level: {1-5}
  target_pyramid_level: {1-5}
  metrics_per_level:
    awareness: ["{metric1}", "{metric2}", "{metric3}"]
    engagement: ["{metric1}", "{metric2}", "{metric3}"]
    commitment: ["{metric1}", "{metric2}", "{metric3}"]
    advocacy: ["{metric1}", "{metric2}", "{metric3}"]
    transformation: ["{metric1}", "{metric2}", "{metric3}"]
  community_health:
    growth_rate: {baseline: "", target: "", status: ""}
    activation_rate: {baseline: "", target: "", status: ""}
    retention_rate: {baseline: "", target: "", status: ""}
    engagement_depth: {baseline: "", target: "", status: ""}
    sentiment_score: {baseline: "", target: "", status: ""}
    advocacy_rate: {baseline: "", target: "", status: ""}
  vitality_index:
    current_score: {0-100}
    threshold: "{thriving|healthy|at-risk|critical|failing}"
    weights: {growth: 15, activation: 20, retention: 25, engagement: 20, sentiment: 10, advocacy: 10}
  reporting_cadence:
    weekly: "Vitality pulse + leading indicators"
    monthly: "Full dashboard + trends + recommendations"
    quarterly: "Impact pyramid review + strategy adjustment"
  alert_triggers:
    - "{condition that triggers escalation}"
```

## Veto Conditions

1. **NEVER define more than 5 metrics per pyramid level** -- metric overload paralyzes action
2. **NEVER skip qualitative markers** -- numbers alone miss the human dimension of movements
3. **NEVER set targets without baselines** -- targets without context are fantasies
4. **NEVER report Vitality Index without context** -- a score without trend and recommendations is noise
5. **NEVER ignore sentiment data** -- a growing but unhappy community is a time bomb

## Completion Criteria

- [ ] Impact Pyramid defined with 5 levels customized to the movement
- [ ] Metrics matrix complete with 3-5 metrics per level
- [ ] Community Health Dashboard designed with 6 dimensions
- [ ] Vitality Index formula defined with weights and thresholds
- [ ] Reporting cadence established (weekly, monthly, quarterly)
- [ ] Alert triggers defined for escalation
- [ ] Current state assessed with baseline measurements
- [ ] Output matches schema above
