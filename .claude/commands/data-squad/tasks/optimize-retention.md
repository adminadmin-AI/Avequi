---
task: optimizeRetention()
responsavel: "@peter-fader"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: business
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: customer_data
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: retention_optimization
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] CLV segmentation complete with 4 tiers"
  - "[ ] Customer Health Score defined with 6 dimensions"
  - "[ ] Intervention playbooks designed per risk level"
---

# Task: Optimize Retention

**Task ID:** DATA-004
**Version:** 1.0.0
**Command:** `*optimize-retention`
**Agent:** Peter Fader (peter-fader) + Nick Mehta (nick-mehta)
**Purpose:** Optimize customer retention and lifetime value through CLV segmentation, churn prediction, and success interventions

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `business` | User prompt | Yes | Business description and model (SaaS, e-commerce, etc.) |
| `customer_data` | User | Yes | Available customer data (transactions, engagement, support) |
| `current_retention` | User | No | Current retention rate and known churn patterns |
| `revenue_model` | User | No | Pricing model, ARPU, expansion revenue |
| `support_structure` | User | No | Current CS team structure and processes |

## Preconditions

- Customer transaction or engagement data exists
- Business model is defined (subscription, transactional, hybrid)
- Metrics frameworks loaded (`data/metrics-frameworks.yaml`)

## Execution Phases

### Phase 1: Segment by CLV (peter-fader)

1. Apply **Customer-Base Analysis** principles:
   - Not all customers are created equal
   - Past behavior predicts future behavior (with uncertainty)
   - Customer heterogeneity is the starting point
2. Calculate **CLV components**:
   - **Recency:** When was the last transaction/engagement
   - **Frequency:** How often do they transact/engage
   - **Monetary:** How much do they spend per transaction
3. Segment customers into **value tiers**:
   - **Platinum (top 5%):** Highest CLV, deepest engagement
   - **Gold (next 15%):** Strong CLV, reliable behavior
   - **Silver (next 30%):** Moderate CLV, growth potential
   - **Bronze (bottom 50%):** Low CLV, high heterogeneity
4. Apply the **BG/NBD model** logic:
   - Estimate probability of each customer being "alive" (active)
   - Predict expected future transactions per customer
   - Identify customers with declining probability (pre-churn)
5. Calculate **customer concentration risk** -- what % of revenue comes from top 20%

### Phase 2: Identify Churn Signals (nick-mehta)

1. Define the **Customer Health Score** with 6 dimensions:
   - **Product usage:** Feature adoption, login frequency, time in app
   - **Support interaction:** Ticket volume, sentiment, escalation rate
   - **Engagement:** Email opens, event attendance, community activity
   - **Business outcome:** Are they achieving their goals with the product
   - **Relationship:** NPS score, executive sponsor engagement
   - **Financial:** Payment timeliness, contract value trend
2. Weight each dimension by predictive power for churn
3. Identify **leading churn indicators** (precede churn by 30-90 days):
   - Usage decline > 30% month-over-month
   - Support tickets with negative sentiment
   - Missed QBR or review meetings
   - Champion departure (contact leaves company)
   - Feature adoption stall (no new features adopted in 60 days)
4. Create **churn risk scoring** (0-100):
   - 0-25: Healthy
   - 26-50: Monitor
   - 51-75: At Risk
   - 76-100: Critical
5. Segment at-risk customers by **save potential** (high, medium, low)

### Phase 3: Design Interventions (nick-mehta)

1. Map interventions to the **10 Laws of Customer Success**:
   - Law 1: Sell to the right customer
   - Law 2: Align around natural tendency to churn
   - Law 3: Customers expect you to make them successful
   - Law 4: Relentlessly monitor and manage health
   - Law 5: You can no longer build loyalty through relationships
   - Law 6: Product is your only scalable differentiator
   - Law 7: Obsess over time-to-value
   - Law 8: Deepen engagement with data-driven decisions
   - Law 9: Drive expansion when customers are successful
   - Law 10: It's a top-down, company-wide commitment
2. Design interventions by risk level:
   - **Healthy:** Proactive success reviews, expansion signals
   - **Monitor:** Increase touchpoints, send usage tips, check goals
   - **At Risk:** Executive outreach, success plan, dedicated resources
   - **Critical:** Save team engagement, executive escalation, incentive offer
3. Define **playbooks** for each intervention type
4. Create **automation rules** for scaled interventions
5. Design the **QBR (Quarterly Business Review)** template

### Phase 4: Measure NRR (peter-fader + nick-mehta)

1. Define and track **Net Revenue Retention (NRR)**:
   - NRR = (Starting MRR + Expansion - Contraction - Churn) / Starting MRR
   - Target: > 100% (net positive = growing without new customers)
2. Track **cohort retention curves**:
   - Monthly cohort analysis
   - Compare curve shapes across segments
   - Identify the "flattening point" (when retention stabilizes)
3. Measure **intervention effectiveness**:
   - Save rate by intervention type
   - Time from intervention to stabilization
   - Cost per save vs CLV recovered
4. Build the **retention dashboard**:
   - NRR trend (monthly)
   - Health score distribution
   - Churn risk pipeline
   - Intervention success rate
5. Define **escalation triggers** for data-chief

## Output Format

```yaml
retention_optimization:
  business: "{name}"
  clv_segmentation:
    platinum: {count: "", pct_revenue: ""}
    gold: {count: "", pct_revenue: ""}
    silver: {count: "", pct_revenue: ""}
    bronze: {count: "", pct_revenue: ""}
  concentration_risk: "{top 20% = X% revenue}"
  health_score:
    dimensions: 6
    churn_signals: ["{signal1}", "{signal2}", "{signal3}"]
  churn_risk_distribution:
    healthy: "{%}"
    monitor: "{%}"
    at_risk: "{%}"
    critical: "{%}"
  nrr:
    current: "{%}"
    target: "{%}"
  interventions:
    playbook_count: {number}
    automation_rules: {number}
  deliverables:
    - clv-segmentation.md
    - health-score-model.md
    - intervention-playbooks.md
    - retention-dashboard.md
```

## Veto Conditions

1. **NEVER treat all customers equally** -- CLV segmentation exists for a reason
2. **NEVER predict churn with a single metric** -- health scores require multiple dimensions
3. **NEVER automate critical-risk interventions** -- human touch is required for save attempts
4. **NEVER ignore expansion in retention strategy** -- NRR > 100% is the goal
5. **NEVER measure retention without cohort analysis** -- aggregate rates hide segment-level problems

## Completion Criteria

- [ ] CLV segmentation complete with 4 tiers
- [ ] Customer Health Score defined with 6 dimensions
- [ ] At least 5 leading churn indicators identified
- [ ] Churn risk scoring implemented (0-100 scale)
- [ ] Intervention playbooks designed for each risk level
- [ ] NRR formula defined with tracking mechanism
- [ ] Retention dashboard designed
- [ ] Output matches schema above
