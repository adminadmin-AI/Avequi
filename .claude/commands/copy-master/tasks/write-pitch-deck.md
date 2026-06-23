---
task: writePitchDeck()
responsavel: "@oren-klaff"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: business
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: audience
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: pitch_deck_copy
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] STRONG method fully executed (all 6 elements)"
  - "[ ] Frame control strategy defined for each section"
  - "[ ] Intrigue + tension arc maintained throughout"
  - "[ ] Psychological Layer applied (Cialdini/Warren principles tagged)"
---

# Task: Write Pitch Deck Copy

**Task ID:** COPY-M-013
**Version:** 2.0.0
**Command:** `*write-pitch-deck`
**Agent:** Oren Klaff (oren-klaff)
**Purpose:** Write pitch deck copy using the STRONG method with frame control and layered persuasion psychology.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| business | string | User prompt | Yes | Business/product with core value proposition |
| audience | enum | User prompt | Yes | investors, partners, clients, internal-stakeholders |
| ask | string | User prompt | Yes | What you're requesting (funding amount, partnership, deal, buy-in) |
| traction | object | User prompt | No | Revenue, users, growth rate, milestones |
| market_data | object | User prompt | No | TAM, SAM, SOM, market trends |
| team | list | User prompt | No | Key team members and credentials |
| competitive_advantage | string | User prompt | No | Unique moat or unfair advantage |
| pitch_context | string | User prompt | No | Where/how the pitch will be delivered (boardroom, demo day, virtual, 1-on-1) |

---

## Preconditions

- Business value proposition clearly defined
- Audience type identified (different audiences require different frames)
- The "ask" is specific and quantified
- At least some traction data or proof points available

---

## Champion Reference

Study these real-world champion pitches before writing:

1. **Airbnb's Original Pitch Deck** (2009) — Clean problem/solution framing, market size with specificity, traction proof, concise ask
2. **Oren Klaff's "Pitch Anything" STRONG Method** — Frame control, intrigue, tension-release pattern, status alignment
3. **Steve Jobs iPhone Launch** (2007) — "Three revolutionary products" pattern interrupt, demonstration-driven proof, status dominance
4. **Sequoia Capital's Pitch Deck Template** — The standard: Problem, Solution, Why Now, Market, Competition, Product, Team, Financials, Ask
5. **Buffer's Transparent Pitch Deck** — Metrics-forward, honest about challenges, social proof through transparency

---

## Execution Phases

### Phase 1: STRONG Method Framework

1. **S -- Set the Frame:** Establish your frame before the audience sets theirs
   - Power frame: Position yourself as the prize, not the supplicant
   - Time frame: Create urgency ("I have 20 minutes to show you something important")
   - Analyst frame: Don't get pulled into spreadsheet details — stay at big-picture
   - Prize frame: They need to qualify to work with YOU
2. **T -- Tell the Story:** Narrative arc that creates intrigue
   - Man-in-the-jungle: Struggle -> Discovery -> Transformation
   - Use novelty and tension to hold attention
   - Never be boring — if the audience's croc brain disengages, you lose
3. **R -- Reveal the Intrigue:** The "aha moment" that changes everything
   - What most people don't know about this market/opportunity
   - The counterintuitive insight that makes this work
   - The unfair advantage that makes competition irrelevant
4. **O -- Offer the Prize:** Position the deal as a scarce opportunity
   - This is not you asking for money — this is you offering a seat at the table
   - Frame the opportunity window: "If not now, then never"
   - Make the audience lean forward to get the deal
5. **N -- Nail the Hookpoint:** The moment they must decide
   - Clear, specific ask with terms
   - Binary frame: in or out
   - No room for "let me think about it" — create urgency to decide
6. **G -- Get the Decision:** Close with frame control
   - Time constraint close: "I need a decision by Friday"
   - Takeaway: "This may not be right for everyone"
   - Next steps: Exactly what happens after they say yes

### Phase 2: Psychological Layer

1. Map Cialdini's principles into the pitch structure:
   - **Authority:** Credentials, traction, team, media mentions (throughout)
   - **Scarcity:** Limited allocation, closing round, opportunity window
   - **Social Proof:** Other investors, customers, advisors already in
   - **Commitment:** Get small yeses throughout ("Does this resonate?")
   - **Liking:** Personal story, shared vision, relatability
   - **Unity:** "We're building something together" — shared mission framing
   - **Reciprocity:** Share a valuable insight they can use even if they don't invest
2. Apply Blair Warren's levers:
   - Encourage dreams: Paint the massive upside
   - Justify failures: "Past investments in this space failed because they lacked X"
   - Allay fears: De-risk the investment with milestones and data
   - Confirm suspicions: "You've probably noticed [market trend] — you're right"
   - Throw rocks at enemies: Incumbents are vulnerable because...
3. Frame control techniques per section:
   - Never let the audience set a "power frame" over you
   - Use "beta traps" awareness — don't fall into subservient positioning
   - Maintain status by controlling the emotional temperature of the room

### Phase 3: Slide-by-Slide Copy Writing

1. **Title Slide:** Provocative one-liner, not company name
2. **Problem Slide:** Vivid, specific pain point with data
3. **Solution Slide:** Your unique mechanism in one sentence
4. **Why Now Slide:** Market timing / convergence / inflection point
5. **Market Size Slide:** TAM -> SAM -> SOM with bottom-up logic
6. **Product Slide:** Demo or screenshot with 3 key differentiators
7. **Traction Slide:** Metrics that prove momentum (graph going up and to the right)
8. **Business Model Slide:** How you make money, unit economics
9. **Competition Slide:** Positioning matrix (not feature comparison)
10. **Team Slide:** Why THIS team wins (credentials + unfair advantage)
11. **The Ask Slide:** Specific amount, use of funds, terms, timeline
12. **Vision Slide:** The 10-year picture that makes them want to be part of it

### Phase 4: Delivery Notes

1. Write speaker notes per slide (what to SAY, not what to read)
2. Mark frame control moments (where to push back, redirect, or take control)
3. Identify the "hot cognition" triggers (emotional beats that bypass analytical thinking)
4. Plan for the croc-brain: keep visual, keep novel, keep moving
5. Prepare objection responses for the 5 most likely challenges
6. Define the "intrigue ping" moments — lines designed to create curiosity

---

## Output Format

```markdown
## Pitch Deck Copy: {Company/Product Name}

**Method:** STRONG (Klaff)
**Audience:** {audience type}
**The Ask:** {specific request}
**Duration:** {X} minutes

### Persuasion Architecture
| Slide/Section | STRONG Element | Cialdini Principles | Warren Levers | Frame Control |
|--------------|---------------|--------------------|--------------  |--------------|
| Title | Set the Frame | Authority | Encourage dreams | Prize frame |
| Problem | Tell the Story | Liking | Confirm suspicions | Power frame |
| ... | ... | ... | ... | ... |

---

### Slide 1: {Title}
**On-slide copy:** {text that appears on the slide}
**Speaker notes:** {what to say}
**Frame control:** {technique for this moment}
**Intrigue ping:** {curiosity trigger}

### Slide 2: {Problem}
**On-slide copy:** {text}
**Speaker notes:** {what to say}
**Data point:** {specific proof}
**Emotional beat:** {hot cognition trigger}

### Slides 3-12: ...

---

### Frame Control Playbook
| Situation | Their Frame | Your Counter-Frame |
|-----------|------------|-------------------|
| "We need more data" | Analyst frame | "I'll send the details — but first, does the vision resonate?" |
| "What about competitor X?" | Power frame | "Good question — here's why they can't do what we do" |
| "Let me think about it" | Delay frame | "I understand — I should mention we're closing [date]" |

### Objection Responses
| Objection | Response | Cialdini Principle Used |
|-----------|---------|----------------------|

### Delivery Notes
- **Total slides:** {count}
- **Key frame control moments:** {list}
- **Hot cognition triggers:** {list}
- **Croc-brain survival tips:** {list}
- **Post-pitch follow-up:** {next steps}
```

---

## Veto Conditions

- NEVER position yourself as the supplicant — the pitch is YOU offering THEM an opportunity
- NEVER let the deck exceed 12 slides for investor pitches — attention spans are finite
- NEVER present market size without bottom-up logic — top-down TAM is meaningless
- NEVER skip traction — even early-stage companies must show momentum
- NEVER end without a specific, time-bound ask — vague asks get vague answers

---

## Completion Criteria

- [ ] STRONG method fully executed (all 6 elements present)
- [ ] Frame control strategy defined for each section
- [ ] Slide-by-slide copy written with on-slide text and speaker notes
- [ ] Intrigue + tension arc maintained throughout
- [ ] Traction/proof data integrated
- [ ] The Ask is specific, quantified, and time-bound
- [ ] Frame Control Playbook provided for common objections
- [ ] Delivery notes with hot cognition triggers
- [ ] Psychological Layer applied — Cialdini principles mapped per slide
- [ ] Blair Warren levers activated across the pitch arc
