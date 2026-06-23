---
task: analyzeStory()
responsavel: "@shawn-coyne"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: story_text
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: intended_genre
    tipo: string
    origem: User Input
    obrigatorio: false

Saida:
  - campo: story_analysis
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Genre identified with core value and obligatory scenes"
  - "[ ] All scenes mapped with turning points and value shifts"
  - "[ ] Issues diagnosed and prioritized with prescriptions"
---

# Task: Story Analysis (Story Grid)

**Task ID:** STORY-004
**Version:** 1.0.0
**Command:** `*analyze-story`
**Agent:** Shawn Coyne (shawn-coyne)
**Purpose:** Analyze a story using the Story Grid methodology to diagnose structural and emotional issues.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `story_text` | User provides draft, outline, or description | YES |
| `intended_genre` | User specification | PREFERRED |
| `target_audience` | User description | NO |
| `specific_concerns` | What the author thinks is wrong | NO |
| `story_format` | Novel, screenplay, short story, episode | NO |

## Preconditions

1. Story material exists (complete draft, partial draft, or detailed outline)
2. Enough content to identify genre conventions and structural patterns
3. Story Grid framework data is accessible

## Execution Phases

### Phase 1: Identify Genre

1. Determine the content genre — Action, Horror, Love, Performance, Society, Status, Worldview
2. Identify the sub-genre — each genre has specific conventions
3. Map the core value at stake:
   - Action: Life/Death
   - Horror: Life/Damnation
   - Love: Love/Hate
   - Performance: Respect/Shame
   - Society: Power/Impotence
   - Status: Success/Failure
   - Worldview: Meaning/Meaninglessness
4. List the obligatory scenes for this genre (what MUST happen)
5. List the conventions for this genre (what the audience expects)
6. Verify: Does the author's intended genre match what the story actually delivers?

### Phase 2: Map Scenes

1. Break the story into scenes (units of action with a value shift)
2. For each scene, identify:
   - **Turning point** — What changes within the scene?
   - **Value shift** — What value moves from positive to negative or vice versa?
   - **Polarity shift** — e.g., Life (+) to Unconsciousness (-)
   - **Story event type** — Active or revelatory turning point
3. Create the Story Grid spreadsheet — scene-by-scene analysis
4. Map the global value arc — does it move from negative to positive (prescriptive) or positive to negative (cautionary)?
5. Identify the five key commandments per scene: Inciting Incident, Progressive Complication, Crisis, Climax, Resolution

### Phase 3: Evaluate Turning Points

1. **Beginning Hook** — Does the inciting incident hook the reader? Is the first turning point compelling?
2. **Middle Build** — Do complications escalate progressively? Is there a midpoint shift? Do stakes continuously rise?
3. **Ending Payoff** — Is the climax satisfying? Does the resolution deliver on the story's promise? Is the transformation earned?
4. Assess the global crisis — is the protagonist's dilemma a genuine best-bad-choice or irreconcilable-goods?
5. Check the obligatory scenes — are all genre-required scenes present and functional?
6. Check conventions — does the story deliver what the genre audience expects?

### Phase 4: Diagnose Issues

1. Identify structural gaps — missing beats, skipped escalation, unearned turns
2. Identify genre failures — missing obligatory scenes, broken conventions
3. Identify emotional failures — value shifts that do not land, flat turning points
4. Identify pacing problems — sagging middle, rushed ending, slow opening
5. Prioritize issues: Critical (story does not work without fixing) > Major (significantly weakens) > Minor (polish-level)
6. Provide specific prescriptions — what to change, add, remove, or restructure
7. Reference genre masters — examples of how similar stories solved these problems

## Output Format

```yaml
story_analysis:
  analyst: "shawn-coyne"
  methodology: "Story Grid"
  genre:
    content_genre: "{genre}"
    sub_genre: "{sub-genre}"
    core_value: "{value at stake}"
    obligatory_scenes_present: ["{scenes found}"]
    obligatory_scenes_missing: ["{scenes missing}"]
    conventions_met: ["{conventions found}"]
    conventions_violated: ["{conventions broken}"]
  scene_map:
    total_scenes: 0
    value_arc: "prescriptive | cautionary"
    key_scenes:
      - scene: "{scene name}"
        turning_point: "{what changes}"
        value_shift: "{from → to}"
        commandments: "{5 commandments assessment}"
  structure_assessment:
    beginning_hook: "{assessment}"
    middle_build: "{assessment}"
    ending_payoff: "{assessment}"
    global_crisis: "{assessment}"
  diagnosis:
    critical_issues: ["{must fix}"]
    major_issues: ["{should fix}"]
    minor_issues: ["{nice to fix}"]
  prescriptions: ["{specific recommendations}"]
```

## Veto Conditions

- **NEVER** analyze without identifying the genre first — genre determines expectations
- **NEVER** provide vague feedback like "it needs more tension" — be specific and prescriptive
- **NEVER** ignore the emotional arc in favor of plot mechanics alone
- **NEVER** judge a story by a framework that does not match its genre
- **NEVER** forget that every scene must have a value shift — scenes without change are not scenes

## Completion Criteria

- [ ] Genre identified with core value and obligatory scenes
- [ ] All scenes mapped with turning points and value shifts
- [ ] Five commandments assessed for key scenes
- [ ] Beginning Hook, Middle Build, and Ending Payoff evaluated
- [ ] Structural, genre, emotional, and pacing issues diagnosed
- [ ] Issues prioritized (Critical > Major > Minor)
- [ ] Specific prescriptions provided for each issue
