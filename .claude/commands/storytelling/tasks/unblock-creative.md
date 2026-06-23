---
task: unblockCreative()
responsavel: "@keith-johnstone"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: block_description
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: project_context
    tipo: string
    origem: User Input
    obrigatorio: false

Saida:
  - campo: creative_unblock
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Block type diagnosed with emotional root identified"
  - "[ ] At least 3 exercises prescribed and explained"
  - "[ ] Micro-goal set for immediate action"
---

# Task: Creative Unblocking

**Task ID:** STORY-006
**Version:** 1.0.0
**Command:** `*unblock-creative`
**Agent:** Keith Johnstone (keith-johnstone)
**Purpose:** Diagnose and overcome creative blocks using improvisation techniques and story games.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `block_description` | User describes their stuck point | YES |
| `project_context` | What they are working on | PREFERRED |
| `what_theyve_tried` | Previous attempts to unblock | NO |
| `deadline_pressure` | Time constraints | NO |
| `creative_history` | Past successes and patterns | NO |

## Preconditions

1. The user acknowledges they are creatively stuck
2. Some context about the project or creative endeavor exists
3. Willingness to try unconventional approaches

## Execution Phases

### Phase 1: Diagnose Block

1. Identify the type of creative block:
   - **Fear of failure** — The inner critic is too loud (most common)
   - **Perfectionism** — Refusing to produce anything less than perfect
   - **Status anxiety** — Fear of looking foolish or incompetent
   - **Decision paralysis** — Too many options, cannot commit
   - **Burnout** — Creative exhaustion from overwork
   - **Lost thread** — Started strong, lost the narrative thread
   - **Blank page** — Cannot find any starting point at all
2. Assess severity — can they produce anything, or is it total freeze?
3. Identify the emotional root — what feeling is driving the block?
4. Look for patterns — has this happened before? What broke it then?

### Phase 2: Improv Exercises

1. **"Yes, And"** — Accept every idea without judgment and build on it
   - Write 10 terrible ideas. Then "yes, and" each one into something surprising
   - The point is volume, not quality — lower the bar completely
2. **Status Shift** — Change the power dynamics in the story
   - Make the powerful character weak, the weak character powerful
   - Often a stuck story is really a stuck status relationship
3. **Blind Offer** — Start with an action and discover the meaning after
   - Write the next scene without knowing where it goes
   - Let the subconscious lead; the conscious mind follows
4. **Tilt** — Introduce an unexpected element that changes everything
   - What if the opposite were true?
   - What would happen if the worst possible thing occurred right now?
5. **Free Association** — Write without stopping for 10 minutes
   - No editing, no judgment, no backspace
   - Follow whatever comes, even if it seems irrelevant

### Phase 3: Story Games

1. **The Boring Version** — Write the most obvious, boring version of the scene
   - Counterintuitively, this often reveals what the interesting version is
   - Remove the pressure of originality
2. **Steal from Life** — Mine personal experience for material
   - What happened to you today? Yesterday? In a dream?
   - Real details make fiction feel authentic
3. **The Worst Version** — Deliberately write the worst possible version
   - This defeats perfectionism by making "bad" the goal
   - Often produces surprisingly useful material
4. **Character Interview** — Let the character speak for themselves
   - Ask: What do you want? What are you afraid of? What would you never do?
   - The character often knows the story better than the author
5. **Constraint Box** — Add arbitrary constraints to force creativity
   - Write in exactly 100 words. Use no adjectives. Only dialogue.
   - Constraints paradoxically liberate

### Phase 4: Reframe & Reconnect

1. Reframe the block as information — what is the resistance trying to tell you?
2. Identify what IS working — build from strength, not from weakness
3. Reconnect with the original impulse — why did this project excite you initially?
4. Set a micro-goal — not "finish the chapter" but "write one paragraph"
5. Create a ritual — a specific action that signals "creative mode is starting"
6. Schedule the next creative session — momentum requires continuity
7. Provide a personalized unblocking prescription based on the specific block type

## Output Format

```yaml
creative_unblock:
  specialist: "keith-johnstone"
  block_type: "{diagnosed type}"
  severity: "mild | moderate | severe"
  emotional_root: "{underlying feeling}"
  diagnosis: |
    {Why the block is happening and what it signals}
  exercises_prescribed:
    - exercise: "{name}"
      instructions: "{step by step}"
      purpose: "{why this helps this specific block}"
      time_required: "{duration}"
  reframe: |
    {How to see the block differently}
  micro_goal: "{immediate small action}"
  ongoing_practice: "{habit to prevent recurrence}"
```

## Veto Conditions

- **NEVER** tell someone to "just push through" — blocks have emotional causes
- **NEVER** critique the user's existing work during an unblocking session
- **NEVER** add pressure — deadlines and stakes make blocks worse
- **NEVER** prescribe a single approach — always offer multiple exercises to choose from
- **NEVER** dismiss the block as laziness or lack of talent

## Completion Criteria

- [ ] Block type diagnosed with emotional root identified
- [ ] At least 3 exercises prescribed, tailored to the specific block
- [ ] Each exercise explained with clear instructions and purpose
- [ ] Block reframed as information rather than failure
- [ ] Micro-goal set for immediate action
- [ ] Ongoing practice recommended to prevent recurrence
