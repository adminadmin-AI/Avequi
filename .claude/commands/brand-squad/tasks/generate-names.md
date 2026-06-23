---
task: generateNames()
responsavel: "@naming-strategist"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: what
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: positioning
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: Naming Strategy with Finalists
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] 30-50 raw candidates generated across 4+ categories"
  - "[ ] All candidates scored on 7 criteria"
  - "[ ] Final 3-5 presented with full profiles"
---

# Task: Generate Names

**Task ID:** BRAND-006
**Version:** 1.0.0
**Command:** `*generate-names`
**Agent:** Naming Strategist (naming-strategist)
**Purpose:** Develop naming candidates through structured creative methodology and strategic evaluation.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| what | string | User prompt | Yes | What is being named (company, product, feature, service) |
| positioning | string | User prompt | Yes | Positioning or value proposition |
| audience | string | User prompt | Yes | Target audience |
| tone | string | User prompt | No | Desired tone (modern, classic, playful, serious, technical) |
| constraints | list | User prompt | No | Length limits, language requirements, sounds to avoid |
| domain_needed | boolean | User prompt | No | Whether .com domain availability matters |
| category_names | list | User prompt | No | Competitor names to avoid similarity |

---

## Preconditions

- What is being named is clearly defined
- Positioning provides enough context to generate relevant names

---

## Execution Phases

### Phase 1: Naming Strategy
1. Define the naming objectives:
   - Must convey: {what the name should communicate}
   - Must feel: {the emotional/tonal quality}
   - Must avoid: {associations, sounds, or competitor overlap}
2. Select naming categories to explore:
   - **Descriptive:** Says what it does (PayPal, YouTube)
   - **Suggestive:** Implies a quality or benefit (Slack, Sprint)
   - **Abstract:** Coined or invented (Kodak, Xerox)
   - **Metaphorical:** Borrowed meaning (Amazon, Apple)
   - **Acronym:** Initials or abbreviation (IBM, BMW)
   - **Founder/Personal:** Named after a person (Tesla, Disney)
   - **Compound:** Two words combined (Facebook, Snapchat)
3. Allocate exploration across at least 4 categories
4. Define the evaluation criteria before generating names

### Phase 2: Name Generation
1. Generate 30-50 raw name candidates across selected categories
2. For each category, use specific techniques:
   - Descriptive: Combine function words with modifiers
   - Suggestive: Use etymology, root words, and sound symbolism
   - Abstract: Create new words using pleasing phonetics
   - Metaphorical: Mine mythology, nature, science, and culture
   - Compound: Pair unexpected word combinations
3. Apply phonetic principles:
   - Strong names often start with hard consonants (K, T, P, B)
   - Short names (1-3 syllables) are more memorable
   - Vowel endings feel friendly and approachable
   - Consonant endings feel strong and decisive
4. Check each name for unintended meanings in major languages

### Phase 3: Evaluation and Shortlisting
1. Score each name on 7 criteria (1-5 each):
   - **Memorability:** Easy to recall after hearing once
   - **Pronounceability:** Easy to say without explanation
   - **Spellability:** Easy to write after hearing
   - **Distinctiveness:** Different from competitors
   - **Relevance:** Connects to positioning or value
   - **Scalability:** Works as the brand grows into new areas
   - **Emotional Resonance:** Evokes the right feeling
2. Rank by total score and select top 10
3. From top 10, recommend final 3-5 with full rationale
4. Note potential domain availability for finalists (if domain matters)

### Phase 4: Name Presentation
1. For each finalist, provide:
   - Name and pronunciation guide
   - Category and etymology
   - What it communicates
   - How it scores across all criteria
   - Potential tagline pairing
   - Visual possibilities (how it might look as a wordmark)
2. Provide the "dark horse" — one unexpected name that could work
3. Suggest next steps: trademark search, domain acquisition, focus group testing

---

## Output Format

```markdown
## Naming Strategy: {What Is Being Named}

**Positioning:** {statement}
**Tone:** {desired tone}
**Audience:** {audience}

---

### Top 5 Finalists

#### 1. {Name}
**Category:** {type}
**Etymology:** {origin and meaning}
**Communicates:** {what it says about the brand}
**Pronunciation:** {phonetic guide}
**Tagline Pairing:** {suggested tagline}
**Scores:** Mem {X} / Pro {X} / Spe {X} / Dis {X} / Rel {X} / Sca {X} / Emo {X} = **{Total}/35**

#### 2-5: ...

### Dark Horse
{Unexpected option with rationale}

### Full Candidate List

| # | Name | Category | Total Score | Notes |
|---|------|----------|-------------|-------|

### Rejected with Rationale
| Name | Why Rejected |
|------|-------------|

### Next Steps
1. Trademark search for top 3
2. Domain availability check
3. Audience reaction testing
```

---

## Veto Conditions

- NEVER submit fewer than 30 raw candidates — quantity enables quality
- NEVER recommend names without checking for negative meanings in other languages
- NEVER recommend names that are unpronounceable without a guide
- NEVER generate names from only one category — diversity reveals the best options
- NEVER skip the evaluation criteria — gut feeling is not a naming strategy

---

## Completion Criteria

- [ ] Naming strategy defined with objectives and constraints
- [ ] 30-50 raw candidates generated across 4+ categories
- [ ] All candidates scored on 7 criteria
- [ ] Top 10 identified and ranked
- [ ] Final 3-5 presented with full profiles
- [ ] Dark horse option included
- [ ] Rejected names documented with rationale
- [ ] Next steps defined (trademark, domain, testing)
