---
task: writeSalesLetter()
responsavel: "@gary-halbert"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: offer
    tipo: object
    origem: User Input
    obrigatorio: true

Saida:
  - campo: sales_letter
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Big promise and emotional driver identified"
  - "[ ] Letter follows AIDA structure with proof throughout"
  - "[ ] CTA appears minimum 3 times with P.S. sections"
  - "[ ] Psychological Layer applied (Cialdini/Warren principles tagged)"
---

# Task: Write Sales Letter

**Task ID:** COPY-M-002
**Version:** 2.0.0
**Command:** `*write-sales-letter`
**Agent:** Gary Halbert (gary-halbert)
**Purpose:** Write a full long-form sales letter that sells through storytelling, emotional connection, and layered persuasion psychology.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Product/service with key features and benefits |
| audience | string | User prompt | Yes | Target audience with pain points and desires |
| offer | object | User prompt | Yes | Price, guarantee, bonuses, urgency elements |
| awareness_level | enum | User prompt | No | Schwartz's 5 levels — defaults to problem-aware |
| proof_elements | list | User prompt | No | Testimonials, stats, credentials, case studies |
| tone | string | User prompt | No | Defaults to conversational, personal, urgent |
| word_count_target | number | User prompt | No | Defaults to 2000-4000 words |

---

## Preconditions

- Product benefits clearly articulated (not just features)
- At least one proof element available (testimonial, stat, or credential)
- Offer structure defined (price, guarantee, bonuses)

---

## Champion Reference

Study these real-world champion sales letters before writing:

1. **"The Boron Letters"** (Gary Halbert) — Personal father-to-son voice, story-driven selling with emotional authenticity
2. **"The Wall Street Journal Letter"** (Martin Conroy) — Two young men parable, ran 28 years generating $2B+, masterclass in problem-aware leads
3. **"The Coat of Arms Letter"** (Gary Halbert) — Simple offer, personal tone, printed millions of copies profitably
4. **"End of America"** (Mike Palmer / Stansberry) — Fear-driven long-form with massive proof stacking, political urgency
5. **"Amazing Diet Secret of a Desperate Housewife"** (Gary Halbert) — Story lead, curiosity, relatability, mechanism reveal

---

## Execution Phases

### Phase 1: Research and Strategy
1. Identify the single most powerful emotion driving the prospect
2. Define the "big promise" — one transformative outcome
3. Map the prospect's current state vs. desired state
4. Identify the unique mechanism that makes this product different
5. Catalog all proof elements and rank by persuasive power
6. Determine the primary objection that must be overcome

### Phase 2: Structure the Letter
1. Outline using the classic Halbert structure:
   - Attention: Headline + opening that grabs by the throat
   - Interest: Story or shocking revelation that builds intrigue
   - Desire: Benefits, proof, and future-pacing
   - Action: Offer, guarantee, urgency, and clear CTA
2. Plan the emotional arc: curiosity to fear to hope to urgency
3. Identify 3-5 transition hooks to maintain the "slippery slide"
4. Place proof elements strategically (early credibility, mid social proof, late risk reversal)

### Phase 3: Psychological Layer
1. Map Cialdini's 7 principles into the letter structure:
   - **Reciprocity:** Free value or insight given before the ask
   - **Commitment/Consistency:** Small yeses building to the big yes
   - **Social Proof:** Testimonials, numbers, "thousands of people" language
   - **Authority:** Credentials, media mentions, expert endorsements
   - **Liking:** Personal story, relatability, shared struggle
   - **Scarcity:** Limited time, limited spots, price increase
   - **Unity:** Shared identity, "people like us" language
2. Apply Blair Warren's 5 levers — ensure at least 3 are present:
   - Encourage dreams (future-pacing the transformation)
   - Justify failures (it's not your fault — the system was broken)
   - Allay fears (the guarantee removes all risk)
   - Confirm suspicions (you've always known X was true)
   - Throw rocks at enemies (the gurus / industry / establishment)
3. Document which principles appear in each section

### Phase 4: Write the Draft
1. Write the headline and lead (first 300 words) — this is 80% of the battle
2. Build the story section with personal, relatable narrative
3. Transition from story to product reveal with a "bridge" paragraph
4. Stack benefits using bullets (fascinations style)
5. Layer proof throughout — never go more than 3 paragraphs without proof
6. Write the offer section: price anchoring, bonuses, guarantee
7. Close with urgency, scarcity, and a single clear CTA
8. Add P.S. sections (Halbert's signature move) — restate offer + add bonus reason

### Phase 5: Polish and Review
1. Read aloud — cut anything that breaks the conversational flow
2. Verify every claim is supported by proof
3. Ensure the letter can be understood by a 7th grader
4. Check that the CTA appears at least 3 times
5. Confirm the guarantee is prominently placed and boldly stated

---

## Output Format

```markdown
## Sales Letter: {Product Name}

**Target:** {audience}
**Awareness:** {level}
**Word Count:** {count}
**Emotional Driver:** {primary emotion}
**Big Promise:** {one-line promise}

### Persuasion Architecture
| Section | Cialdini Principles | Warren Levers |
|---------|--------------------|--------------  |
| Lead | {principles} | {levers} |
| Story | {principles} | {levers} |
| Benefits | {principles} | {levers} |
| Close | {principles} | {levers} |

---

### [HEADLINE]
{headline}

### [SUB-HEADLINE]
{sub-headline}

### [LETTER BODY]
{full sales letter with natural paragraph breaks}

### [P.S. SECTIONS]
P.S. {first postscript}
P.P.S. {second postscript}

---

### Writer's Notes
- **Lead type:** {story, proclamation, prediction, secret, problem-solution}
- **Key proof used:** {list}
- **Primary objection addressed:** {objection + how}
- **Cialdini principles used:** {list with locations}
- **Warren levers activated:** {list with locations}
- **Suggested split test:** {element to test}
```

---

## Veto Conditions

- NEVER write without a defined offer (price + guarantee minimum)
- NEVER open with the product name for unaware/problem-aware audiences
- NEVER write a letter without at least one proof element
- NEVER use passive voice in the CTA
- NEVER submit without P.S. sections — they are the second-most-read element

---

## Completion Criteria

- [ ] Big promise and emotional driver identified
- [ ] Letter follows AIDA structure with Halbert's personal style
- [ ] Headline and lead are compelling standalone pieces
- [ ] Proof elements woven throughout (not dumped in one section)
- [ ] Offer clearly stated with price anchoring and guarantee
- [ ] At least 2 P.S. sections included
- [ ] CTA appears minimum 3 times
- [ ] Readability at 7th-grade level or below
- [ ] Psychological Layer applied — Cialdini principles mapped per section
- [ ] Blair Warren levers identified and activated
- [ ] Writer's notes included with strategic rationale
