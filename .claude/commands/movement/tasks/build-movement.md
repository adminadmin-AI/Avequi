---
task: buildMovement()
responsavel: "@movement-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: cause
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: audience
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: movement_build
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Spark analysis completed and validated"
  - "[ ] All 6 deliverable documents produced"
  - "[ ] End-to-end coherence validated"
---

# Task: Build Movement

**Task ID:** MOVEMENT-001
**Version:** 1.0.0
**Command:** `*build-movement`
**Agent:** Movement Chief (movement-chief)
**Purpose:** Orchestrate the full 5-phase movement building process from spark to impact

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `cause` | User prompt | Yes | The cause, idea, or brand to build a movement around |
| `audience` | User prompt | Yes | Target audience or community description |
| `context` | Session | No | Market context, existing brand assets, competitors |
| `phase_override` | User | No | Start from a specific phase (skip earlier phases) |
| `intensity` | User | No | Scale: grassroots, regional, national, global |

## Preconditions

- Squad config loaded (`config/config.yaml`)
- All specialist agents available: fenomenologo, identitario, manifestador, estrategista-de-ciclo, analista-de-impacto
- Routing catalog loaded (`data/routing-catalog.yaml`)
- Movement frameworks loaded (`data/movement-frameworks.yaml`)

## Execution Phases

### Phase 1: Spark (fenomenologo)

1. Identify the **lived experience** that unites the target audience
2. Map the **collective tension** -- what frustration, pain, or aspiration is shared
3. Uncover the **shared narrative** -- what story do people already tell themselves
4. Articulate the **movement spark** -- the crystallized insight that ignites action
5. Validate the spark against the Phenomenological Analysis framework
6. Deliver `spark-analysis.md` with findings

**Checkpoint:** movement-chief reviews spark validity before proceeding

### Phase 2: Identity (identitario)

1. Define the **belief system** -- core beliefs that unite members
2. Design **tribal markers** -- language, symbols, visual identity, rituals
3. Establish the **Identity Stack**: values > beliefs > behaviors > symbols > rituals
4. Create **in-group signals** -- how members recognize each other
5. Define the **out-group boundary** -- what the movement stands against
6. Deliver `identity-architecture.md` with the full identity framework

**Checkpoint:** movement-chief validates identity coherence with spark

### Phase 3: Ignition (manifestador)

1. Draft the **manifesto** using the 7-component anatomy
2. Define the **origin story** -- mythologize the founding moment
3. Create the **battle cry** -- a single sentence that mobilizes
4. Design the **first ritual** -- the entry experience for new members
5. Seed the **founding circle** -- identify and recruit first 10 believers
6. Deliver `manifesto.md` and `ignition-plan.md`

**Checkpoint:** movement-chief approves manifesto alignment with identity

### Phase 4: Growth (estrategista-de-ciclo)

1. Design the **Growth Flywheel**: Attract > Activate > Sustain > Multiply
2. Plan **attraction channels** -- where to find future believers
3. Create **activation rituals** -- how newcomers become active members
4. Build **sustain mechanics** -- engagement loops, content cadence, events
5. Design **multiplication triggers** -- how members recruit new members
6. Deliver `growth-strategy.md` with flywheel details and timeline

**Checkpoint:** movement-chief validates growth plan feasibility

### Phase 5: Impact (analista-de-impacto)

1. Define the **Impact Pyramid** -- 5 levels from awareness to transformation
2. Set **metrics per level** -- quantitative and qualitative indicators
3. Design **community health dashboard** -- engagement, sentiment, growth rate
4. Calculate the **Vitality Index** -- composite health score
5. Create **reporting cadence** -- weekly pulse, monthly deep-dive, quarterly review
6. Deliver `impact-framework.md` with metrics and measurement plan

**Checkpoint:** movement-chief approves impact framework completeness

## Output Format

```yaml
movement_build:
  name: "{movement name}"
  cause: "{cause summary}"
  spark: "{one-line spark insight}"
  identity:
    core_belief: "{central belief}"
    battle_cry: "{one sentence}"
    tribal_markers: ["{marker1}", "{marker2}", "{marker3}"]
  manifesto_status: "complete"
  growth_flywheel: "{attract > activate > sustain > multiply}"
  impact_metrics:
    vitality_index: "{score}/100"
    primary_kpi: "{metric}"
  deliverables:
    - spark-analysis.md
    - identity-architecture.md
    - manifesto.md
    - ignition-plan.md
    - growth-strategy.md
    - impact-framework.md
  status: "{complete|in-progress|blocked}"
```

## Veto Conditions

1. **NEVER skip the Spark phase** -- every movement must start with a genuine shared experience
2. **NEVER proceed to Identity without a validated spark** -- identity built on false premises collapses
3. **NEVER write a manifesto before identity is defined** -- manifestos express identity, not create it
4. **NEVER launch growth without a manifesto** -- growth without message is noise
5. **NEVER measure impact without defined metrics** -- measurement requires a framework first

## Completion Criteria

- [ ] Spark analysis completed and validated by movement-chief
- [ ] Identity architecture defined with full Identity Stack
- [ ] Manifesto written with all 7 components
- [ ] Growth flywheel designed with all 4 phases
- [ ] Impact pyramid defined with metrics per level
- [ ] Vitality Index formula established
- [ ] All 6 deliverable documents produced
- [ ] End-to-end coherence validated (spark threads through to impact)
