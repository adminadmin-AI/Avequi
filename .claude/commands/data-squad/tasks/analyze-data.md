---
task: analyzeData()
responsavel: "@avinash-kaushik"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: business
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: channels
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: analytics_framework
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] DMMM applied with objectives, goals, KPIs, targets"
  - "[ ] OMTM identified"
  - "[ ] Dashboard designed with Actions row"
---

# Task: Analyze Data

**Task ID:** DATA-001
**Version:** 1.0.0
**Command:** `*analyze-data`
**Agent:** Avinash Kaushik (avinash-kaushik)
**Purpose:** Design analytics frameworks and dashboards using the Digital Marketing and Measurement Model (DMMM)

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `business` | User prompt | Yes | Business description and objectives |
| `channels` | User prompt | Yes | Active digital channels (web, social, email, etc.) |
| `current_tracking` | User | No | Existing analytics tools and what is tracked today |
| `audience_segments` | User | No | Known audience segments |
| `stage` | User | No | Business stage: pre-launch, growth, mature |

## Preconditions

- Business objectives defined (even at high level)
- At least one active digital channel
- Metrics frameworks loaded (`data/metrics-frameworks.yaml`)

## Execution Phases

### Phase 1: Define Business Questions

1. Identify the **3-5 critical business questions** the stakeholder needs answered
2. Map each question to a **See-Think-Do-Care** stage:
   - **See:** Largest addressable qualified audience
   - **Think:** Audience with some commercial intent
   - **Do:** Audience with strong commercial intent
   - **Care:** Existing customers (2+ transactions)
3. Prioritize questions by impact on business decisions
4. Identify **what decisions will change** based on the answers
5. Reject vanity questions -- if the answer won't change a decision, it doesn't matter

### Phase 2: Select Metrics (DMMM)

1. For each business question, apply the **Digital Marketing and Measurement Model**:
   - **Business Objective** -- what we want to achieve
   - **Goal** -- specific measurable target
   - **KPI** -- metric that indicates progress toward the goal
   - **Target** -- numerical threshold for success
   - **Segment** -- which audience slice this applies to
2. Apply the **"So What?" test** to every metric -- if you can't say what action you'd take, remove it
3. Limit to **10-15 total KPIs** across all objectives (Kaushik's 10/90 rule)
4. Ensure a mix of **acquisition, behavior, and outcome** metrics
5. Define the **one metric that matters most** (OMTM) for this period

### Phase 3: Design Dashboard

1. Structure the dashboard using the **See-Think-Do-Care** framework
2. For each stage, show:
   - **Primary KPI** with trend (up/down/flat)
   - **Supporting metrics** (2-3 max)
   - **Comparison** -- period over period or segment over segment
3. Include the **"Actions" row** -- what should be done based on current data
4. Apply Kaushik's dashboard principles:
   - No more than 1 page per audience
   - Every metric has a "so what" annotation
   - Include at least one competitive benchmark
5. Define refresh frequency (real-time, daily, weekly)

### Phase 4: Implement Tracking

1. Map each KPI to a **data source** (GA4, CRM, social analytics, etc.)
2. Define **tracking events** needed for behavior metrics
3. Create a **measurement plan** document:
   - Event name, trigger, parameters, source
4. Identify **data gaps** -- metrics we want but can't measure yet
5. Prioritize gap-closing by impact on decision quality

## Output Format

```yaml
analytics_framework:
  business: "{name}"
  business_questions: ["{q1}", "{q2}", "{q3}"]
  omtm: "{one metric that matters most}"
  stdc_metrics:
    see: {kpi: "", target: "", source: ""}
    think: {kpi: "", target: "", source: ""}
    do: {kpi: "", target: "", source: ""}
    care: {kpi: "", target: "", source: ""}
  total_kpis: {number}
  dashboard:
    pages: {number}
    refresh: "{real-time|daily|weekly}"
    sections: ["{section1}", "{section2}"]
  tracking_plan:
    events_defined: {number}
    data_gaps: ["{gap1}", "{gap2}"]
  deliverables:
    - analytics-framework.md
    - dashboard-design.md
    - tracking-plan.md
```

## Veto Conditions

1. **NEVER include a metric without the "So What?" test** -- every metric must drive a decision
2. **NEVER exceed 15 KPIs total** -- metric overload destroys focus
3. **NEVER build a dashboard without the Actions row** -- data without action is decoration
4. **NEVER track without a measurement plan** -- ad-hoc tracking creates unreliable data
5. **NEVER skip competitive benchmarks** -- internal data without context is meaningless

## Completion Criteria

- [ ] 3-5 business questions defined and mapped to See-Think-Do-Care
- [ ] DMMM applied with objectives, goals, KPIs, targets, segments
- [ ] OMTM (One Metric That Matters) identified
- [ ] Dashboard designed with max 15 KPIs and Actions row
- [ ] Tracking plan created with events and data sources
- [ ] Data gaps identified and prioritized
- [ ] Output matches schema above
