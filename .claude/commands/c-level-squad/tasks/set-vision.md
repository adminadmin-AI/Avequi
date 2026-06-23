---
task: setVision()
responsavel: "@vision-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: company
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: industry
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: strategic_vision
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Mission and vision statements crafted"
  - "[ ] 3-5 strategic pillars set with OKRs"
  - "[ ] 3-year roadmap created with annual themes"
---

# Task: Set Vision

**Task ID:** CLEVEL-001
**Version:** 1.0.0
**Command:** `*set-vision`
**Agent:** Vision Chief (vision-chief)
**Purpose:** Define company vision, mission, strategic pillars, and create a multi-year roadmap

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `company` | User prompt | Yes | Company name and description |
| `industry` | User prompt | Yes | Industry or market sector |
| `current_state` | User | Yes | Current stage, revenue, team size, challenges |
| `ambition` | User | No | Where the founder wants to be in 3-5 years |
| `existing_mission` | User | No | Any existing mission/vision statements |

## Preconditions

- Company exists or is in pre-launch with a defined concept
- Stakeholder with decision authority is engaged
- Executive frameworks loaded (`data/executive-frameworks.yaml`)

## Execution Phases

### Phase 1: Assess Current State

1. Conduct a **strategic situational assessment**:
   - Where are we now? (revenue, team, product, market position)
   - What are our strengths and moats?
   - What are our critical vulnerabilities?
   - What external forces are shaping our industry?
2. Apply **Porter's 5 Forces** analysis:
   - Competitive rivalry intensity
   - Threat of new entrants
   - Threat of substitutes
   - Bargaining power of suppliers
   - Bargaining power of buyers
3. Identify the **strategic gap** -- distance between current state and ambition
4. Assess **organizational readiness** for transformation
5. Document findings in a strategic assessment summary

### Phase 2: Define Mission and Vision

1. Craft the **Mission Statement** (why we exist today):
   - Format: "We [action] for [audience] by [method] so that [outcome]"
   - Must be specific enough to guide daily decisions
   - Must be broad enough to allow growth
2. Craft the **Vision Statement** (where we're going):
   - Format: "A world where [desired future state]"
   - Timeframe: 5-10 year horizon
   - Must be inspiring yet achievable
3. Define **Core Values** (3-5 values):
   - Each value must have a behavioral definition
   - Values must be distinctive (not generic corporate platitudes)
   - Test: "Would we sacrifice short-term profit for this value?"
4. Create the **Vision-Mission-Strategy Cascade**:
   - Vision (why) > Mission (what) > Strategy (how) > Tactics (when/where)
5. Validate: does a new employee reading these know what to prioritize?

### Phase 3: Set Strategic Pillars

1. Define **3-5 Strategic Pillars** -- the major bets for the next 3 years:
   - Each pillar must directly connect to the vision
   - Each pillar must be measurable with clear outcomes
   - Pillars must collectively cover the strategic gap
2. For each pillar, define:
   - **Objective:** What we want to achieve
   - **Key Results:** 2-3 measurable outcomes (OKR style)
   - **Owner:** Which C-level role leads this pillar
   - **Timeline:** 12-month milestones
   - **Dependencies:** What must be true for this to succeed
3. Apply the **BCG Matrix** to current and planned offerings:
   - Stars (high growth, high share): invest
   - Cash Cows (low growth, high share): harvest
   - Question Marks (high growth, low share): decide
   - Dogs (low growth, low share): divest
4. Identify **strategic trade-offs** -- what we will NOT do
5. Validate: do the pillars collectively close the strategic gap?

### Phase 4: Create Roadmap

1. Build a **3-year strategic roadmap**:
   - Year 1: Foundation (build capabilities, achieve milestones)
   - Year 2: Scale (grow what works, cut what doesn't)
   - Year 3: Transform (reach vision-level impact)
2. For each year, define:
   - **Theme:** One word that captures the year's focus
   - **Top 3 priorities:** Most important outcomes
   - **Key investments:** Where resources will flow
   - **Success criteria:** How we know we're on track
3. Identify **strategic inflection points** -- decisions that will need to be made
4. Create the **quarterly review cadence** -- when and how strategy is reviewed
5. Define **pivot triggers** -- conditions that would require strategy revision

## Output Format

```yaml
strategic_vision:
  company: "{name}"
  mission: "{mission statement}"
  vision: "{vision statement}"
  core_values: ["{value1}", "{value2}", "{value3}"]
  strategic_pillars:
    - name: "{pillar}"
      objective: "{what}"
      key_results: ["{kr1}", "{kr2}"]
      owner: "{c-level role}"
      timeline: "{milestones}"
  porters_five_forces:
    rivalry: "{low|medium|high}"
    new_entrants: "{low|medium|high}"
    substitutes: "{low|medium|high}"
    supplier_power: "{low|medium|high}"
    buyer_power: "{low|medium|high}"
  roadmap:
    year_1: {theme: "", priorities: [], investments: []}
    year_2: {theme: "", priorities: [], investments: []}
    year_3: {theme: "", priorities: [], investments: []}
  review_cadence: "quarterly"
  deliverables:
    - strategic-assessment.md
    - vision-mission-values.md
    - strategic-pillars.md
    - 3-year-roadmap.md
```

## Veto Conditions

1. **NEVER define vision without assessing current state** -- vision without grounding is delusion
2. **NEVER have more than 5 strategic pillars** -- focus requires saying no
3. **NEVER skip the trade-offs** -- strategy is as much about what you won't do
4. **NEVER create a roadmap without quarterly review points** -- strategy must adapt
5. **NEVER write generic values** -- "integrity" and "excellence" mean nothing without behavioral definitions

## Completion Criteria

- [ ] Current state assessed with Porter's 5 Forces
- [ ] Mission statement crafted (specific and actionable)
- [ ] Vision statement crafted (inspiring and time-bound)
- [ ] 3-5 core values defined with behavioral descriptions
- [ ] 3-5 strategic pillars set with OKRs and owners
- [ ] BCG Matrix applied to offerings
- [ ] 3-year roadmap created with annual themes
- [ ] Pivot triggers and review cadence defined
- [ ] Output matches schema above
