---
task: createIdentity()
responsavel: "@identitario"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: spark_analysis
    tipo: string
    origem: Phase 1 Output
    obrigatorio: true
  - campo: cause
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: identity_architecture
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Belief system defined with central conviction"
  - "[ ] Tribal markers designed across all categories"
  - "[ ] Belonging gradient defined with 5 levels"
---

# Task: Create Identity

**Task ID:** MOVEMENT-003
**Version:** 1.0.0
**Command:** `*create-identity`
**Agent:** Identitario (identitario)
**Purpose:** Architect the complete identity system for a movement including beliefs, markers, rituals, and signals

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `spark_analysis` | Phase 1 output | Yes | Phenomenological analysis with validated spark |
| `cause` | User prompt | Yes | The movement's cause or purpose |
| `audience` | User prompt | Yes | Target community description |
| `existing_brand` | User | No | Existing brand assets to incorporate |
| `cultural_context` | User | No | Cultural norms and sensitivities |

## Preconditions

- Spark analysis completed and validated (MOVEMENT-002 or Phase 1 of MOVEMENT-001)
- Movement frameworks loaded (`data/movement-frameworks.yaml`)
- Collective tension intensity >= 3 (movement-grade)

## Execution Phases

### Phase 1: Define Belief System

1. Extract **core values** from the spark analysis (3-5 values)
2. Translate values into **beliefs** -- "We believe that..."
3. Define the **central conviction** -- the one non-negotiable belief
4. Establish **belief hierarchy**: foundational > supporting > aspirational
5. Create the **belief manifesto fragment** -- 3-5 belief statements
6. Test: can a stranger read these beliefs and immediately know if they belong

### Phase 2: Design Tribal Markers

1. Define **language markers** -- words, phrases, and jargon unique to the movement
2. Design **visual identity** -- colors, symbols, logo direction, aesthetic
3. Create **behavioral markers** -- actions that signal membership
4. Establish **status markers** -- how members show depth of commitment
5. Design **greeting/recognition rituals** -- how members acknowledge each other
6. Build the **Marker Inventory** with usage guidelines

### Phase 3: Create Rituals

1. Design the **initiation ritual** -- the entry experience for new members
2. Create **daily rituals** -- small repeated practices that reinforce identity
3. Design **gathering rituals** -- what happens when the community meets
4. Establish **celebration rituals** -- how victories and milestones are marked
5. Create **storytelling rituals** -- how members share experiences and testimonials
6. Map rituals to the **Ritual Architecture** framework: frequency, format, emotional arc

### Phase 4: Establish In-Group Signals

1. Define the **us vs them** boundary -- clear but not hostile
2. Create **recognition signals** -- how members identify each other in the wild
3. Design **inside references** -- shared knowledge that bonds members
4. Establish **loyalty markers** -- how long-term members are recognized
5. Create the **belonging gradient** -- from curious outsider to core believer
6. Define **boundary rules** -- what behaviors lead to exclusion

## Output Format

```yaml
identity_architecture:
  movement: "{name}"
  identity_stack:
    values: ["{value1}", "{value2}", "{value3}"]
    beliefs:
      central: "{core belief statement}"
      supporting: ["{belief1}", "{belief2}"]
      aspirational: ["{belief3}"]
    behaviors: ["{behavior1}", "{behavior2}", "{behavior3}"]
    symbols: ["{symbol1}", "{symbol2}", "{symbol3}"]
    rituals: ["{ritual1}", "{ritual2}", "{ritual3}"]
  tribal_markers:
    language: ["{term1}", "{term2}", "{term3}"]
    visual: "{aesthetic description}"
    behavioral: ["{action1}", "{action2}"]
    status: ["{level1}", "{level2}", "{level3}"]
  ritual_architecture:
    initiation: "{description}"
    daily: "{description}"
    gathering: "{description}"
    celebration: "{description}"
    storytelling: "{description}"
  belonging_gradient:
    - level: "Curious"
      description: "{what defines this level}"
    - level: "Sympathizer"
      description: "{what defines this level}"
    - level: "Member"
      description: "{what defines this level}"
    - level: "Advocate"
      description: "{what defines this level}"
    - level: "Core Believer"
      description: "{what defines this level}"
  boundary:
    inclusion_criteria: "{what makes someone belong}"
    exclusion_triggers: ["{trigger1}", "{trigger2}"]
```

## Veto Conditions

1. **NEVER build identity without a validated spark** -- identity must grow from real shared experience
2. **NEVER create exclusionary identity based on demographics** -- movements unite around beliefs, not birth traits
3. **NEVER design rituals that require deception** -- authenticity is foundational
4. **NEVER skip the belief system** -- markers without beliefs are costume, not identity
5. **NEVER create hostile out-group framing** -- define "us" positively, not "them" negatively

## Completion Criteria

- [ ] Belief system defined with central conviction and hierarchy
- [ ] Tribal markers designed across all categories (language, visual, behavioral, status)
- [ ] At least 5 rituals created covering initiation through celebration
- [ ] Belonging gradient defined with 5 levels
- [ ] In-group signals established with recognition mechanics
- [ ] Boundary rules defined (inclusion and exclusion)
- [ ] Identity coherence validated against spark analysis
- [ ] Output matches schema above
