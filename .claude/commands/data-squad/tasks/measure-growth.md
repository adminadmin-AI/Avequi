---
task: measureGrowth()
responsavel: "@sean-ellis"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: current_metrics
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: growth_analysis
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] North Star Metric defined with input metrics"
  - "[ ] At least 5 hypotheses generated and ICE-scored"
  - "[ ] Experiment log created with tracking plan"
---

# Task: Measure Growth

**Task ID:** DATA-002
**Version:** 1.0.0
**Command:** `*measure-growth`
**Agent:** Sean Ellis (sean-ellis)
**Purpose:** Find the North Star Metric, design growth experiments using ICE scoring, and analyze results

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `product` | User prompt | Yes | Product or service description |
| `current_metrics` | User | Yes | Current growth numbers (users, revenue, retention) |
| `pmf_status` | User | No | Product-market fit status (pre/post PMF) |
| `growth_stage` | User | No | Stage: traction, transition, growth, mature |
| `experiment_budget` | User | No | Resources available for experimentation |

## Preconditions

- Product exists with measurable user activity
- Basic analytics in place (can measure user actions)
- Metrics frameworks loaded (`data/metrics-frameworks.yaml`)

## Execution Phases

### Phase 1: Find North Star Metric

1. Assess **Product-Market Fit** using the Sean Ellis test:
   - Survey: "How would you feel if you could no longer use this product?"
   - **Very disappointed** >= 40% = PMF achieved
   - < 40% = focus on PMF before growth
2. Identify the **core value moment** -- the single action that delivers value
3. Define the **North Star Metric (NSM)** -- the one metric that captures value delivery
   - Must reflect **customer value** (not just company revenue)
   - Must be **leadable** (team can influence it)
   - Must be **measurable** (can track weekly)
4. Map the **input metrics** that drive the NSM:
   - Breadth (how many users)
   - Depth (how much each user engages)
   - Frequency (how often they engage)
5. Validate: does improving the NSM always improve the business?

### Phase 2: Design Experiment (ICE Score)

1. Generate **5-10 growth hypotheses** from AARRR funnel analysis:
   - **Acquisition:** How users find us
   - **Activation:** First value experience
   - **Retention:** Users come back
   - **Referral:** Users bring others
   - **Revenue:** Users pay
2. Score each hypothesis using **ICE Framework**:
   - **Impact** (1-10): How much will this move the NSM?
   - **Confidence** (1-10): How sure are we this will work?
   - **Ease** (1-10): How easy is this to implement?
   - **ICE Score** = (Impact + Confidence + Ease) / 3
3. Rank experiments by ICE score
4. Select top 2-3 experiments for the current sprint
5. For each selected experiment, define:
   - Hypothesis statement: "If we [action], then [metric] will [change] because [reason]"
   - Success metric and target
   - Minimum sample size
   - Duration

### Phase 3: Run Test

1. Define **control and variant** for each experiment
2. Set up **tracking** for experiment-specific metrics
3. Determine **statistical significance** requirements (typically p < 0.05)
4. Plan the **experiment timeline** (minimum 1-2 weeks)
5. Identify **guardrail metrics** -- what must NOT decrease during the experiment
6. Document the experiment in the **experiment log**

### Phase 4: Analyze Results

1. Collect data after experiment duration completes
2. Calculate **statistical significance** of results
3. Measure **impact on NSM** -- did the North Star move?
4. Check **guardrail metrics** -- was anything harmed?
5. Determine verdict:
   - **Winner:** Implement permanently, document learning
   - **Loser:** Kill, document learning
   - **Inconclusive:** Extend duration or increase sample
6. Update the **growth model** with new learnings
7. Feed results back into the next ICE scoring round

## Output Format

```yaml
growth_analysis:
  product: "{name}"
  pmf_score: "{percentage} very disappointed"
  pmf_status: "{pre-pmf|post-pmf}"
  north_star_metric:
    name: "{metric name}"
    current_value: "{number}"
    target: "{number}"
    input_metrics:
      breadth: "{metric}"
      depth: "{metric}"
      frequency: "{metric}"
  experiments:
    - hypothesis: "{if/then statement}"
      ice_score: {number}
      status: "{planned|running|complete}"
      result: "{winner|loser|inconclusive|pending}"
  aarrr_analysis:
    weakest_stage: "{acquisition|activation|retention|referral|revenue}"
    biggest_opportunity: "{description}"
  deliverables:
    - north-star-analysis.md
    - experiment-backlog.md
    - experiment-results.md
```

## Veto Conditions

1. **NEVER optimize for growth before achieving PMF** -- growth amplifies what exists, good or bad
2. **NEVER run experiments without guardrail metrics** -- winning one metric by destroying another is a loss
3. **NEVER declare a winner without statistical significance** -- anecdotes are not data
4. **NEVER score ICE without team input** -- confidence scores need diverse perspectives
5. **NEVER ignore negative results** -- losers teach as much as winners

## Completion Criteria

- [ ] PMF assessed with Sean Ellis survey methodology
- [ ] North Star Metric defined with input metrics
- [ ] AARRR funnel analyzed with weakest stage identified
- [ ] At least 5 hypotheses generated and ICE-scored
- [ ] Top 2-3 experiments designed with hypotheses and success metrics
- [ ] Experiment log created with tracking plan
- [ ] Output matches schema above
