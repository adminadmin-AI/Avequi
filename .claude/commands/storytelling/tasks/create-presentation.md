---
task: createPresentation()
responsavel: "@nancy-duarte"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: presentation_topic
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: audience
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: presentation
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Audience profiled with current beliefs and resistance mapped"
  - "[ ] Sparkline structure created with alternating contrasts"
  - "[ ] Star moment designed and call to action defined"
---

# Task: Presentation Narrative Arc

**Task ID:** STORY-005
**Version:** 1.0.0
**Command:** `*create-presentation`
**Agent:** Nancy Duarte (nancy-duarte)
**Purpose:** Design a presentation narrative using the Sparkline methodology (What Is / What Could Be).

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `presentation_topic` | User prompt | YES |
| `audience` | Who will attend | YES |
| `desired_action` | What audience should do after | YES |
| `key_data` | Supporting facts, metrics, research | PREFERRED |
| `duration` | Time available | NO (default: 20 min) |
| `existing_content` | Current slides or notes | NO |

## Preconditions

1. Topic and key message are defined
2. Audience is identified with their context and concerns
3. Desired audience action after the presentation is clear

## Execution Phases

### Phase 1: Audience Analysis

1. Profile the audience — role, knowledge level, concerns, motivations
2. Identify their current belief — what do they think is true right now?
3. Map their resistance — what would make them reject your message?
4. Define the gap — the distance between their current belief and your desired belief
5. Determine the emotional journey — where do they start and where must they end?
6. Identify the one key takeaway — if they remember only one thing, what is it?

### Phase 2: Sparkline Structure

1. **Opening (What Is)** — Describe the current reality vividly
   - Ground the audience in shared experience
   - Acknowledge the pain or limitation they feel
   - Use a relatable story or striking statistic
2. **First Contrast (What Could Be)** — Reveal the possibility
   - Paint the better future in concrete terms
   - Create desire — make them want this future
3. **Toggle Back and Forth** — Alternate between current pain and future promise
   - Each toggle raises the stakes
   - Layer in evidence: data, stories, examples, analogies
   - Build momentum — each round is more compelling
4. **The Star Moment** — A single memorable moment the audience will never forget
   - A dramatic demonstration, surprising statistic, or powerful story
   - This is the emotional peak of the presentation
5. **Call to Action** — The specific step to move from "what is" to "what could be"
   - Make it concrete, achievable, and immediate
   - Connect it to the audience's values and motivations

### Phase 3: What-Is / What-Could-Be Content

1. For each "What Is" section:
   - Use concrete, specific examples of current pain
   - Reference data that validates the problem
   - Keep it honest — do not exaggerate, but do not soften
2. For each "What Could Be" section:
   - Use vivid imagery of the transformed future
   - Show proof that the future is achievable (case studies, precedents)
   - Connect emotionally — show human impact
3. Design transitions — each toggle should flow naturally
4. Plan visual support — what slides/visuals amplify each moment?
5. Balance data and story — neither dominates, both reinforce

### Phase 4: New Bliss

1. Paint the "New Bliss" — the world after the audience acts
2. Make it specific and tangible — not abstract promises
3. Connect back to the opening — close the narrative loop
4. End with a resonant final image or statement
5. Design the echo — the phrase or idea that stays with them for days
6. Prepare for Q&A — anticipate the top questions and prepare concise answers

## Output Format

```yaml
presentation:
  topic: "{presentation topic}"
  specialist: "nancy-duarte"
  methodology: "Sparkline"
  audience: "{target audience}"
  desired_action: "{what audience should do}"
  duration: "{time}"
  key_takeaway: "{one thing to remember}"
  sparkline:
    - section: "Opening — What Is"
      content: "{current reality}"
      visual_support: "{slide concept}"
      duration: "{time}"
    - section: "Contrast 1 — What Could Be"
      content: "{the possibility}"
      visual_support: "{slide concept}"
      duration: "{time}"
    # ... additional toggles
    - section: "Star Moment"
      content: "{memorable peak}"
      visual_support: "{dramatic visual}"
      duration: "{time}"
    - section: "Call to Action"
      content: "{specific ask}"
      duration: "{time}"
    - section: "New Bliss"
      content: "{transformed future}"
      duration: "{time}"
  star_moment: "{description of the memorable moment}"
  closing_statement: "{resonant ending}"
  qa_prep:
    - question: "{anticipated question}"
      answer: "{prepared response}"
```

## Veto Conditions

- **NEVER** start with a boring agenda slide — open with story or striking data
- **NEVER** present all "what is" followed by all "what could be" — alternate them
- **NEVER** skip the star moment — every great presentation needs one unforgettable moment
- **NEVER** end without a clear call to action — audiences need to know what to do next
- **NEVER** let data replace story — data proves, story persuades; use both

## Completion Criteria

- [ ] Audience profiled with current beliefs and resistance mapped
- [ ] Sparkline structure created with alternating contrasts
- [ ] Star moment designed for maximum impact
- [ ] Each section has content and visual support concepts
- [ ] Call to action is concrete and achievable
- [ ] New Bliss paints a compelling transformed future
- [ ] Timing fits within the allocated duration
