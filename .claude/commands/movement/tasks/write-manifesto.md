---
task: writeManifesto()
responsavel: "@manifestador"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: identity_architecture
    tipo: string
    origem: Phase 2 Output
    obrigatorio: true
  - campo: cause
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: manifesto
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Manifesto includes all 7 components"
  - "[ ] Enemy named as systemic force, not person"
  - "[ ] Call to action includes concrete first step"
---

# Task: Write Manifesto

**Task ID:** MOVEMENT-004
**Version:** 1.0.0
**Command:** `*write-manifesto`
**Agent:** Manifestador (manifestador)
**Purpose:** Create a powerful movement manifesto that declares beliefs, names the enemy, and calls people to action

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `identity_architecture` | Phase 2 output | Yes | Complete identity framework from identitario |
| `spark_analysis` | Phase 1 output | Yes | Phenomenological analysis with narrative kernel |
| `cause` | User prompt | Yes | The movement's cause |
| `tone` | User | No | Desired tone: revolutionary, inspirational, urgent, poetic |
| `length` | User | No | Target length: short (500w), standard (1000w), epic (2000w) |

## Preconditions

- Identity architecture completed (MOVEMENT-003)
- Spark analysis available with narrative kernel
- Belief system defined with central conviction
- Movement frameworks loaded (`data/movement-frameworks.yaml`)

## Execution Phases

### Phase 1: Declare Reality

1. Open with the **undeniable truth** -- a statement about the world that the audience immediately recognizes
2. Describe the **current state** in vivid, emotional terms
3. Name the **pain** that people feel but rarely articulate
4. Use the narrative kernel from the spark analysis as foundation
5. Write 2-3 paragraphs that make the reader think "someone finally said it"

### Phase 2: State Beliefs

1. Declare "We believe..." statements drawn from the identity architecture
2. Lead with the **central conviction** -- the strongest belief
3. Build a **crescendo** of beliefs -- each more ambitious than the last
4. Include the **contrarian belief** -- what we believe that others don't
5. End beliefs section with the **aspirational belief** -- the dream
6. Write 3-7 belief statements, each its own paragraph

### Phase 3: Name the Enemy

1. Identify the **systemic enemy** -- a force, system, or mindset (never a person)
2. Articulate **why this enemy persists** -- what keeps it in power
3. Describe the **cost of inaction** -- what happens if nothing changes
4. Frame the enemy as **defeatable** -- powerful but not invincible
5. Use language that unites against the enemy without promoting hate

### Phase 4: Envision the Future

1. Paint the **promised land** -- what the world looks like when the movement succeeds
2. Make it **specific and sensory** -- the reader should see, feel, and hear it
3. Connect the future to **individual transformation** -- how each person's life changes
4. Connect to **collective impact** -- how the community/world changes
5. Bridge from dream to possibility -- "This is not just a dream, it is within reach"

### Phase 5: Call to Action

1. Shift from vision to **invitation** -- "Join us"
2. Define the **first step** -- one concrete action anyone can take today
3. Establish the **commitment** -- what it means to be part of this
4. Close with the **battle cry** -- one sentence that captures everything
5. End with a line that echoes in the reader's mind

## Output Format

```yaml
manifesto:
  title: "{manifesto title}"
  movement: "{movement name}"
  word_count: {number}
  tone: "{revolutionary|inspirational|urgent|poetic}"
  components:
    reality_declaration: "{opening truth}"
    belief_count: {number}
    central_belief: "{core belief}"
    named_enemy: "{systemic enemy}"
    promised_land: "{future vision summary}"
    battle_cry: "{one sentence}"
    call_to_action: "{first step}"
  full_text: |
    {complete manifesto text}
  usage_guidelines:
    - "{where and how to use this manifesto}"
    - "{adaptation guidelines for different formats}"
```

## Veto Conditions

1. **NEVER name a person or specific group as the enemy** -- enemies must be systemic forces or mindsets
2. **NEVER write beliefs that contradict the identity architecture** -- the manifesto expresses identity, not invents it
3. **NEVER use hateful, discriminatory, or dehumanizing language** -- movements inspire, they don't destroy
4. **NEVER skip the call to action** -- a manifesto without action is an essay
5. **NEVER produce generic, platitude-filled text** -- every sentence must carry weight and specificity

## Completion Criteria

- [ ] Reality declaration opens with undeniable truth
- [ ] At least 3 belief statements rooted in identity architecture
- [ ] Enemy named as systemic force (not person or group)
- [ ] Future vision is specific and sensory
- [ ] Call to action includes one concrete first step
- [ ] Battle cry is one memorable sentence
- [ ] Manifesto reads as a cohesive, emotionally compelling document
- [ ] Word count within target range
- [ ] Output matches schema above
