---
task: createPositioning()
responsavel: "@al-ries"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: brand
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: category
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: Positioning Strategy
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Category ladder mapped with competitor positions"
  - "[ ] Formal positioning statement written with alternatives"
  - "[ ] Messaging guidelines and proof points provided"
---

# Task: Create Positioning

**Task ID:** BRAND-002
**Version:** 1.0.0
**Command:** `*create-positioning`
**Agent:** Al Ries (al-ries)
**Purpose:** Create a positioning statement that owns a distinct space in the prospect's mind.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| brand | string | User prompt | Yes | Brand name and current description |
| category | string | User prompt | Yes | Market category the brand competes in |
| audience | string | User prompt | Yes | Target audience |
| competitors | list | User prompt | Yes | Key competitors with their positioning |
| differentiator | string | User prompt | No | Known or suspected point of difference |
| brand_values | list | User prompt | No | Core values and beliefs |

---

## Preconditions

- Competitive landscape understood (who else competes for the same mind space)
- Target audience defined with their current perceptions

---

## Execution Phases

### Phase 1: Category Analysis
1. Define the category ladder — how prospects mentally organize options
2. Identify who owns the #1 position in the category
3. Map all competitors to their claimed positions
4. Identify the open positions (white space) in the prospect's mind
5. Assess whether to compete in the existing category or create a new one:
   - If #1 is vulnerable: Challenge the leader
   - If #1 is dominant: Find an open position (niche, attribute, or use case)
   - If no clear category: Create the category and own it

### Phase 2: Positioning Strategy
1. Apply the Ries positioning principles:
   - **Narrow the focus:** Better to own a small niche than compete broadly
   - **Own a word:** What single word should the brand own in the prospect's mind?
   - **Be the opposite:** If the leader is X, position as the opposite of X
   - **Be first:** If you cannot be first in the category, create a category where you are first
2. Define the positioning triangle:
   - Target: Who specifically is this for?
   - Frame of Reference: What category does this compete in?
   - Point of Difference: What makes it uniquely better for the target?
   - Reason to Believe: What proof supports the claim?
3. Test the positioning against 3 criteria:
   - Is it relevant to the target audience?
   - Is it differentiated from competitors?
   - Is it credible and deliverable?

### Phase 3: Positioning Statement
1. Write the formal positioning statement:
   "For {target audience} who {need/want}, {brand} is the {category} that {point of difference} because {reason to believe}."
2. Write 3 variations with different emphasis:
   - Target-led: Emphasizes who it is for
   - Benefit-led: Emphasizes what it delivers
   - Category-led: Emphasizes the new category or niche owned
3. Write the positioning tagline (5-8 words maximum)
4. Define the positioning proof points (3-5 evidence items)

### Phase 4: Positioning Activation
1. Translate the positioning into messaging guidelines:
   - Key messages by audience segment
   - Elevator pitch (30 seconds)
   - Long-form positioning narrative (1-2 paragraphs)
2. Define what the positioning means for:
   - Product development (what to build and not build)
   - Marketing (what to say and not say)
   - Sales (how to pitch and differentiate)
3. Identify positioning risks:
   - Competitor response scenarios
   - Category shifts that could invalidate the position
4. Set the positioning review cadence

---

## Output Format

```markdown
## Positioning Strategy: {Brand Name}

**Category:** {category}
**Target:** {audience}
**Owned Word:** {the word this brand will own}
**Strategy Type:** {challenge-leader / find-niche / create-category}

---

### Category Map

| Position | Brand | Claim |
|----------|-------|-------|
| #1 | {brand} | {their position} |
| #2 | {brand} | {their position} |
| Open | — | {white space} |
| **Ours** | **{brand}** | **{our position}** |

### Positioning Statement
"For {target} who {need}, {brand} is the {category} that {difference} because {proof}."

### Alternative Versions
1. **Target-led:** {version}
2. **Benefit-led:** {version}
3. **Category-led:** {version}

### Tagline
{5-8 word tagline}

### Proof Points
1. {evidence}
2. {evidence}
3. {evidence}

### Messaging Guidelines
**Elevator Pitch:** {30-second version}
**Key Messages:**
- For {segment 1}: {message}
- For {segment 2}: {message}

### Positioning Narrative
{1-2 paragraph story of the positioning}

### Risks and Mitigations
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
```

---

## Veto Conditions

- NEVER position without analyzing the competitive landscape — positioning is relative
- NEVER claim a position the brand cannot credibly own
- NEVER try to be everything to everyone — narrow focus wins
- NEVER position on price alone — it is the weakest positioning strategy
- NEVER change positioning without understanding what the brand currently owns in minds

---

## Completion Criteria

- [ ] Category ladder mapped with competitor positions
- [ ] White space identified
- [ ] Positioning strategy selected (challenge, niche, or create)
- [ ] Formal positioning statement written with alternatives
- [ ] Tagline created
- [ ] Proof points defined
- [ ] Messaging guidelines provided
- [ ] Risks identified with mitigations
