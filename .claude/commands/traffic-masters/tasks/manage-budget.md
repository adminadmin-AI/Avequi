---
task: manageBudget()
responsavel: "@fiscal"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: total_budget
    tipo: number
    origem: User Input
    obrigatorio: true
  - campo: campaign_data
    tipo: object
    origem: User Input
    obrigatorio: true

Saida:
  - campo: budgetOptimization
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Current allocation mapped with marginal ROAS"
  - "[ ] 3 budget scenarios modeled with projections"
  - "[ ] Reallocation plan phased over 1-2 weeks"
---

# Task: Manage Budget

**Task ID:** TRAFFIC-007
**Version:** 1.0.0
**Command:** `*manage-budget`
**Agent:** Fiscal (fiscal)
**Purpose:** Optimize budget allocation across campaigns, platforms, and funnel stages.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| total_budget | number | User prompt | Yes | Total monthly ad budget |
| platforms | list | User prompt | Yes | Active platforms with current allocation |
| campaign_data | object | User prompt | Yes | Performance by campaign (spend, CPA, ROAS, conversions) |
| revenue_target | number | User prompt | No | Monthly revenue goal |
| max_cpa | number | User prompt | No | Maximum acceptable CPA |
| min_roas | number | User prompt | No | Minimum acceptable ROAS |
| growth_mode | enum | User prompt | No | maintain, grow, aggressive — defaults to grow |

---

## Preconditions

- At least 30 days of campaign performance data
- Multiple campaigns or platforms to allocate between
- Clear KPI targets defined

---

## Execution Phases

### Phase 1: Current Allocation Analysis
1. Map current spend distribution:
   - By platform
   - By campaign
   - By funnel stage (TOF, MOF, BOF)
2. Calculate marginal ROAS per campaign (the return on the last dollar spent)
3. Identify diminishing returns — where is spending more not producing more?
4. Calculate wasted spend (campaigns below minimum ROAS threshold)
5. Assess budget utilization (are campaigns spending their full budgets?)

### Phase 2: Optimization Modeling
1. Rank all campaigns by efficiency:
   - CPA-ranked (lowest CPA first)
   - ROAS-ranked (highest ROAS first)
   - Volume-ranked (most conversions first)
2. Apply the portfolio optimization principle:
   - Allocate incrementally to the highest-returning campaign
   - Until that campaign's marginal return equals the next best option
   - Continue until all budget is allocated or minimum thresholds hit
3. Model 3 budget scenarios:
   - Conservative: Maintain ROAS, maximize profit
   - Growth: Accept 10-20% CPA increase for volume
   - Aggressive: Accept 30-50% CPA increase for maximum scale
4. Calculate projected results for each scenario

### Phase 3: Reallocation Plan
1. Define the budget shift:
   - From: Campaigns losing budget (with impact analysis)
   - To: Campaigns gaining budget (with projected benefit)
2. Phase the reallocation over 1-2 weeks (not overnight):
   - Week 1: 50% of the shift (monitor for disruption)
   - Week 2: Remaining 50% (if Week 1 stable)
3. Set guardrails for the transition:
   - Maximum daily budget change per campaign
   - CPA monitoring thresholds during transition
   - Rollback triggers if performance degrades
4. Account for platform learning phases during budget changes

### Phase 4: Ongoing Management Framework
1. Define the budget review cadence:
   - Daily: Spend pacing check (on track vs plan?)
   - Weekly: Performance review and minor adjustments
   - Monthly: Full reallocation review
2. Set automated rules where possible:
   - Pause ad set if CPA exceeds X for 3 consecutive days
   - Increase budget 15% if CPA below target for 7 consecutive days
   - Alert if daily spend deviates more than 20% from plan
3. Create the monthly budget report template
4. Plan the next quarter's budget based on performance trends

---

## Output Format

```markdown
## Budget Optimization: {Business/Account}

**Total Budget:** ${X}/month
**Current ROAS:** {X}:1
**Target ROAS:** {X}:1
**Growth Mode:** {mode}

---

### Current Allocation

| Campaign/Platform | Monthly Spend | CPA | ROAS | Marginal ROAS | Status |
|-------------------|--------------|-----|------|---------------|--------|

**Wasted Spend:** ${X}/month on underperformers
**Underutilized:** ${X}/month budget not being spent

### Scenario Modeling

| Scenario | Budget | Projected CPA | Projected ROAS | Projected Revenue |
|----------|--------|--------------|----------------|------------------|
| Conservative | ${X} | ${X} | {X}:1 | ${X} |
| Growth | ${X} | ${X} | {X}:1 | ${X} |
| Aggressive | ${X} | ${X} | {X}:1 | ${X} |

### Recommended Reallocation

| Campaign | Current | New | Change | Rationale |
|----------|---------|-----|--------|-----------|

### Transition Plan
| Week | Action | Monitor |
|------|--------|---------|

### Automated Rules
| Rule | Trigger | Action |
|------|---------|--------|

### Monthly Review Template
{Template for ongoing budget management}
```

---

## Veto Conditions

- NEVER reallocate 100% of budget in a single day — learning phases require gradual changes
- NEVER cut a profitable campaign to zero without confirmation — reduce first, monitor, then decide
- NEVER allocate based on revenue alone — consider profit margin (ROAS vs CPA)
- NEVER ignore platform learning phase impacts when shifting budget
- NEVER set automated rules without kill-switch thresholds

---

## Completion Criteria

- [ ] Current allocation mapped with marginal ROAS
- [ ] Wasted and underutilized spend identified
- [ ] 3 budget scenarios modeled with projections
- [ ] Reallocation plan phased over 1-2 weeks
- [ ] Guardrails and rollback triggers defined
- [ ] Automated rules configured
- [ ] Monthly review cadence and template established
