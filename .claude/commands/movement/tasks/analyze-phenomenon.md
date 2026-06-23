---
task: analyzePhenomenon()
responsavel: "@fenomenologo"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: subject
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: audience
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: phenomenological_analysis
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Lived experience identified with essential structures"
  - "[ ] Collective tension mapped with intensity rating"
  - "[ ] Movement potential rated with justification"
---

# Task: Analyze Phenomenon

**Task ID:** MOVEMENT-002
**Version:** 1.0.0
**Command:** `*analyze-phenomenon`
**Agent:** Fenomenologo (fenomenologo)
**Purpose:** Conduct phenomenological analysis to identify shared lived experiences that can spark a movement

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `subject` | User prompt | Yes | The phenomenon, experience, or tension to analyze |
| `audience` | User prompt | Yes | The group whose experience is being analyzed |
| `context` | Session | No | Cultural, market, or social context |
| `data_sources` | User | No | Interviews, surveys, social media threads, forums |

## Preconditions

- Movement frameworks loaded (`data/movement-frameworks.yaml`)
- Subject is a human experience, not a product feature
- Target audience is identifiable and reachable

## Execution Phases

### Phase 1: Identify Lived Experience

1. Define the **phenomenon** -- what experience is being examined
2. Bracket assumptions -- suspend preconceptions about the experience (epoche)
3. Collect **first-person accounts** -- how people describe this experience in their own words
4. Identify **essential structures** -- what elements are always present in the experience
5. Map the **emotional landscape** -- what feelings accompany the experience
6. Document raw findings in unfiltered form

### Phase 2: Map Collective Tension

1. Identify the **gap** between how things are and how people want them to be
2. Name the **frustration** -- what specific pain or friction people feel
3. Detect **systemic patterns** -- is this tension personal or structural
4. Assess **tension intensity** on a 5-point scale:
   - 1: Mild annoyance (weak spark potential)
   - 2: Recurring frustration (moderate potential)
   - 3: Active pain point (good potential)
   - 4: Identity-level conflict (strong potential)
   - 5: Existential tension (movement-grade potential)
5. Map who else feels this tension -- scope and scale

### Phase 3: Find Shared Narrative

1. Extract the **common story** people tell themselves about this experience
2. Identify the **villain** -- what or who is blamed for the tension
3. Identify the **hero archetype** -- who do people aspire to become
4. Find the **turning point** -- what would change everything
5. Test narrative resonance -- does this story feel universally true to the audience
6. Distill into a **narrative kernel** -- one paragraph that captures the shared story

### Phase 4: Articulate Aspiration

1. Define the **desired future state** -- what the world looks like when the tension is resolved
2. Name the **transformation** -- what changes for the individual
3. Name the **impact** -- what changes for the collective
4. Craft the **aspiration statement** -- one sentence that captures the dream
5. Validate: does this aspiration feel both ambitious and achievable
6. Rate movement potential: LOW / MEDIUM / HIGH / CRITICAL

## Output Format

```yaml
phenomenological_analysis:
  phenomenon: "{name}"
  audience: "{target group}"
  lived_experience:
    essential_structures: ["{element1}", "{element2}", "{element3}"]
    emotional_landscape: ["{emotion1}", "{emotion2}", "{emotion3}"]
  collective_tension:
    gap: "{current state vs desired state}"
    frustration: "{named frustration}"
    intensity: {1-5}
    scope: "{personal|community|structural|systemic}"
  shared_narrative:
    villain: "{what/who is blamed}"
    hero_archetype: "{who people aspire to be}"
    turning_point: "{what would change everything}"
    narrative_kernel: |
      {one paragraph shared story}
  aspiration:
    desired_future: "{future state}"
    transformation: "{individual change}"
    impact: "{collective change}"
    aspiration_statement: "{one sentence}"
  movement_potential: "{LOW|MEDIUM|HIGH|CRITICAL}"
```

## Veto Conditions

1. **NEVER analyze a product feature as a phenomenon** -- phenomenology studies human experience, not products
2. **NEVER fabricate lived experiences** -- all findings must trace to real human accounts
3. **NEVER skip the bracketing step** -- assumptions contaminate analysis
4. **NEVER rate movement potential above MEDIUM without intensity >= 3** -- weak tension cannot sustain a movement
5. **NEVER produce a narrative kernel without validating resonance** -- a story that doesn't resonate is fiction

## Completion Criteria

- [ ] Lived experience identified with essential structures documented
- [ ] Collective tension mapped with intensity rating (1-5)
- [ ] Shared narrative distilled with villain, hero, and turning point
- [ ] Aspiration articulated with transformation and impact
- [ ] Movement potential rated with justification
- [ ] Narrative kernel written and resonance-tested
- [ ] Output matches schema above
