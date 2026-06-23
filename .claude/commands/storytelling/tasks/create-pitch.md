---
task: createPitch()
responsavel: "@oren-klaff"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: pitch_subject
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: target_audience
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: pitch_narrative
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Audience profiled with decision criteria mapped"
  - "[ ] Narrative approach selected and all beats structured"
  - "[ ] Clear ask with objection handling prepared"
---

# Task: Pitch Deck Narrative

**Task ID:** STORY-002
**Version:** 1.0.0
**Command:** `*create-pitch`
**Agent:** Oren Klaff (oren-klaff) or Nancy Duarte (nancy-duarte)
**Purpose:** Craft a compelling pitch narrative that captures attention and drives action.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `pitch_subject` | User prompt | YES |
| `target_audience` | Investors, clients, partners, internal | YES |
| `desired_outcome` | Funding, deal, approval, buy-in | YES |
| `key_data_points` | Metrics, traction, financials | PREFERRED |
| `time_limit` | Pitch duration | NO (default: 10 min) |
| `existing_deck` | Current slides or outline | NO |

## Preconditions

1. Clear understanding of what is being pitched
2. Target audience identified with their decision-making context
3. Key data points available to support the narrative

## Execution Phases

### Phase 1: Analyze Audience

1. Profile the audience — who are they, what do they value, what are their fears?
2. Identify their current frame — how do they see the world right now?
3. Map their decision criteria — what must be true for them to say yes?
4. Determine status dynamics — are you pitching up, down, or laterally?
5. Identify potential objections and resistance points
6. Select approach: Klaff (frame control, tension) or Duarte (sparkline, transformation)

### Phase 2: Structure Narrative

**If Klaff approach (oren-klaff):**
1. **Set the Frame** — Establish your frame as the dominant one (prize frame, time frame, authority frame)
2. **Tell the Story** — Hook with intrigue, build tension, create desire
3. **Reveal the Intrigue** — The unique insight or opportunity that changes everything
4. **Offer the Prize** — Position yourself/product as the prize, not the seller
5. **Nail the Hookpoint** — The moment they lean in and want more
6. **Get the Decision** — Drive to a clear yes/no (not "let me think about it")

**If Duarte approach (nancy-duarte):**
1. **What Is** — Paint the current reality (the audience's world today)
2. **What Could Be** — Reveal the possibility (the better future)
3. **Alternate** — Toggle between current pain and future promise (sparkline)
4. **Call to Action** — The specific step to move from "what is" to "what could be"
5. **New Bliss** — Paint the transformed future vividly

### Phase 3: Build Tension

1. Identify the core tension — the gap between current state and possibility
2. Amplify urgency — why must this happen now? What is the cost of inaction?
3. Layer in proof points — data, testimonials, traction that validates the narrative
4. Create emotional peaks — moments of surprise, delight, or concern
5. Manage pacing — fast for excitement, slow for gravity
6. Handle objections preemptively — weave answers into the narrative

### Phase 4: Design Resolution

1. Make the ask crystal clear — exactly what you want and by when
2. Simplify the decision — reduce it to a binary choice
3. Create next steps — immediate actions after the pitch
4. End with resonance — a memorable closing image or statement
5. Prepare for Q&A — anticipate the top 5 questions and prepare responses
6. Design the leave-behind — what stays with them after you leave the room

## Output Format

```yaml
pitch_narrative:
  subject: "{what is being pitched}"
  approach: "klaff_frame_control | duarte_sparkline"
  specialist: "oren-klaff | nancy-duarte"
  audience: "{target audience}"
  desired_outcome: "{what success looks like}"
  duration: "{estimated time}"
  narrative_beats:
    - beat: 1
      name: "{beat name}"
      content: "{what to say/show}"
      emotional_target: "{audience feeling}"
      duration: "{time allocation}"
  tension_points: ["{key moments of tension}"]
  proof_points: ["{data and evidence}"]
  the_ask: "{specific request}"
  objection_handling:
    - objection: "{anticipated concern}"
      response: "{preemptive answer}"
  closing_statement: "{memorable ending}"
```

## Veto Conditions

- **NEVER** pitch without understanding the audience first
- **NEVER** bury the ask — it must be explicit and clear
- **NEVER** rely on data alone without emotional narrative
- **NEVER** create a pitch longer than the time limit allows
- **NEVER** leave the audience without clear next steps

## Completion Criteria

- [ ] Audience profiled with decision criteria mapped
- [ ] Narrative approach selected and justified
- [ ] All beats structured with content and emotional targets
- [ ] Tension built with urgency and proof points
- [ ] Clear ask with simplified decision path
- [ ] Objection handling prepared
- [ ] Memorable closing designed
