---
task: buildNarrative()
responsavel: "@story-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: story_concept
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: genre_or_context
    tipo: string
    origem: User Input
    obrigatorio: false

Saida:
  - campo: narrative_structure
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Framework selected with reasoning"
  - "[ ] All structural beats defined and populated"
  - "[ ] Emotional arc mapped from beginning to end"
---

# Task: Story Structure Creation

**Task ID:** STORY-001
**Version:** 1.0.0
**Command:** `*build-narrative`
**Agent:** Story Chief (story-chief) routes to Campbell, Snyder, or Harmon
**Purpose:** Build a complete narrative structure using the most appropriate storytelling framework.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `story_concept` | User prompt | YES |
| `genre_or_context` | User description | PREFERRED |
| `target_audience` | User specification | PREFERRED |
| `format` | Film, TV, book, presentation, brand | NO |
| `existing_material` | Draft, outline, notes | NO |
| `preferred_framework` | Hero's Journey, Beat Sheet, Story Circle | NO |

## Preconditions

1. Story concept or idea is provided (even rough/incomplete is fine)
2. At least a general sense of the intended audience or purpose exists
3. Narrative frameworks catalog is accessible

## Execution Phases

### Phase 1: Identify Framework (story-chief)

1. Analyze the story concept — theme, genre, scale, emotional core
2. Determine the best framework match:
   - **Hero's Journey (Campbell)** — Epic transformations, mythic scale, archetypal characters
   - **Beat Sheet (Snyder)** — Commercial screenplays, tight plotting, audience-friendly structure
   - **Story Circle (Harmon)** — TV episodes, character-driven arcs, relatable journeys
3. If user specified a framework, honor the preference
4. If no preference, recommend with reasoning and confirm before proceeding
5. Route to the appropriate specialist agent

### Phase 2: Build Structure

**If Hero's Journey (joseph-campbell):**
1. Define the Ordinary World — establish normal before disruption
2. Identify the Call to Adventure — what disrupts the status quo
3. Map the Threshold Crossing — commitment to the journey
4. Design Tests, Allies, and Enemies — the adventure unfolds
5. Craft the Ordeal — the central crisis and transformation
6. Define the Reward, Road Back, and Resurrection
7. Close with Return with the Elixir — transformation complete

**If Beat Sheet (blake-snyder):**
1. Opening Image — visual thesis of the world before
2. Theme Stated — the lesson the story will teach
3. Set-Up, Catalyst, Debate — introduction through commitment
4. Break into Two — hero enters the upside-down world
5. B Story, Fun and Games — the promise of the premise
6. Midpoint, Bad Guys Close In — stakes escalate
7. All Is Lost, Dark Night of the Soul — lowest point
8. Break into Three, Finale — the solution and climax
9. Final Image — visual antithesis showing transformation

**If Story Circle (dan-harmon):**
1. YOU — Establish the character in their comfort zone
2. NEED — Something is missing or desired
3. GO — They enter an unfamiliar situation
4. SEARCH — They adapt and struggle
5. FIND — They get what they wanted
6. TAKE — But they pay a heavy price
7. RETURN — They go back to the familiar
8. CHANGE — They are transformed by the experience

### Phase 3: Flesh Out Beats

1. For each structural beat, define:
   - The scene or moment (what happens)
   - The emotional state of the protagonist
   - The conflict or tension present
   - How it connects to the theme
2. Identify the emotional arc — map feeling progression from start to end
3. Ensure escalating stakes — each beat raises the tension
4. Verify theme integration — every beat reinforces the central message

### Phase 4: Review Arc

1. Check completeness — no structural gaps or missing beats
2. Verify emotional coherence — the arc feels natural and earned
3. Test the transformation — does the ending feel satisfying and inevitable?
4. Assess pacing — no beat lingers too long or rushes too fast
5. Confirm audience alignment — will this resonate with the target audience?
6. Provide revision notes for any weak points

## Output Format

```yaml
narrative_structure:
  concept: "{story concept}"
  framework: "Hero's Journey | Beat Sheet | Story Circle"
  specialist: "joseph-campbell | blake-snyder | dan-harmon"
  genre: "{identified genre}"
  theme: "{central theme}"
  protagonist:
    name: "{character}"
    starting_state: "{before transformation}"
    ending_state: "{after transformation}"
  beats:
    - beat_number: 1
      name: "{beat name}"
      description: "{what happens}"
      emotional_state: "{feeling}"
      conflict: "{tension}"
      theme_connection: "{how it ties to theme}"
  emotional_arc: "{description of emotional journey}"
  pacing_notes: "{rhythm and tempo observations}"
  revision_suggestions: ["{areas to strengthen}"]
```

## Veto Conditions

- **NEVER** force a framework that does not fit the story's nature
- **NEVER** skip beats or structural elements — every framework requires completeness
- **NEVER** ignore the emotional arc in favor of plot mechanics
- **NEVER** build structure without connecting every beat to the theme
- **NEVER** assume the format — confirm with the user when ambiguous

## Completion Criteria

- [ ] Framework selected with reasoning (or user preference honored)
- [ ] All structural beats defined and populated
- [ ] Emotional arc mapped from beginning to end
- [ ] Theme integrated into every beat
- [ ] Pacing assessed and balanced
- [ ] Arc reviewed for completeness and coherence
- [ ] Revision suggestions provided for weak areas
