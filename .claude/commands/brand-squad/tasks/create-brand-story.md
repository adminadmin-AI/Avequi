---
task: createBrandStory()
responsavel: "@donald-miller"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: brand
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: problem
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: StoryBrand BrandScript
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] All 7 SB7 elements defined"
  - "[ ] One-liner and elevator pitch created"
  - "[ ] Website wireframe copy provided"
---

# Task: Create Brand Story

**Task ID:** BRAND-004
**Version:** 1.0.0
**Command:** `*create-brand-story`
**Agent:** Donald Miller (donald-miller)
**Purpose:** Build a brand narrative using the StoryBrand SB7 Framework.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| brand | string | User prompt | Yes | Brand name and what it does |
| audience | string | User prompt | Yes | Target customer and their world |
| problem | string | User prompt | Yes | The problem the brand solves |
| solution | string | User prompt | Yes | How the brand solves it |
| brand_values | list | User prompt | No | Core values and beliefs |
| founder_story | string | User prompt | No | Origin story of the founder/company |
| proof_elements | list | User prompt | No | Testimonials, results, credentials |

---

## Preconditions

- Brand positioning defined (what the brand stands for)
- Target audience's desires and fears understood

---

## Execution Phases

### Phase 1: StoryBrand BrandScript (SB7)
1. Define each of the 7 elements:
   - **A Character:** The customer is the hero, not the brand. Define who they are and what they want.
   - **Has a Problem:** Define the villain (the root cause), and 3 levels of problem:
     - External: The tangible, surface-level problem
     - Internal: How the problem makes them feel
     - Philosophical: Why this is just plain wrong
   - **Meets a Guide:** Position the brand as the wise guide who has been there. Express:
     - Empathy: "We understand what you're going through"
     - Authority: "We have the expertise to help"
   - **Who Gives Them a Plan:** Provide a simple 3-step plan:
     - Step 1: {action} — What the customer does first
     - Step 2: {action} — What happens next
     - Step 3: {action} — The final step to the result
   - **And Calls Them to Action:** Define the direct CTA and the transitional CTA:
     - Direct: "Buy now," "Schedule a call," "Sign up"
     - Transitional: "Download the guide," "Watch the video," "Take the quiz"
   - **That Helps Them Avoid Failure:** What does life look like if they do NOT act? Paint the negative stakes.
   - **And Ends in Success:** What does life look like when they succeed? Paint the positive transformation.

### Phase 2: Story Execution
1. Write the one-liner (logline for the brand):
   - Problem + Solution + Result in one sentence
   - Must be memorable enough to repeat at a dinner party
2. Write the brand story narrative (2-3 paragraphs):
   - Open with the customer's struggle
   - Introduce the brand as the guide
   - Reveal the plan and the transformation
3. Write the website wireframe copy using StoryBrand:
   - Header: Promise of transformation
   - Stakes: What they stand to lose
   - Value Proposition: What they gain
   - Guide: Why they should trust you
   - Plan: The 3-step path
   - CTA: What to do next
4. Write the elevator pitch (60 seconds)

### Phase 3: Story Applications
1. Create story-based copy for key touchpoints:
   - About page: The brand as guide (not hero)
   - Email welcome: Empathy + authority + first step
   - Social media bio: One-liner + CTA
   - Sales pitch opening: Customer problem + empathy
2. Write the "campfire story" — a 2-minute version told aloud
3. Create the FAQ as story resolution (questions map to SB7 elements)
4. Develop the testimonial framework (what questions to ask customers so their stories follow the SB7 arc)

---

## Output Format

```markdown
## Brand Story: {Brand Name}

**Framework:** StoryBrand SB7

---

### BrandScript

#### 1. Character (Hero = Customer)
**Who they are:** {description}
**What they want:** {desire}

#### 2. Problem
**Villain:** {root cause}
**External:** {tangible problem}
**Internal:** {how it feels}
**Philosophical:** {why it's wrong}

#### 3. Guide (Brand)
**Empathy:** {we understand statement}
**Authority:** {proof of expertise}

#### 4. Plan
1. {Step 1}
2. {Step 2}
3. {Step 3}

#### 5. Call to Action
**Direct CTA:** {primary action}
**Transitional CTA:** {softer entry point}

#### 6. Failure (Stakes)
{What happens if they don't act}

#### 7. Success (Transformation)
{What life looks like after}

---

### One-Liner
{Problem + Solution + Result in one sentence}

### Brand Narrative
{2-3 paragraph story}

### Elevator Pitch
{60-second spoken version}

### Website Wireframe Copy
{Header, stakes, value prop, guide, plan, CTA sections}

### Touchpoint Applications
| Touchpoint | Copy Approach | Key SB7 Element |
|-----------|--------------|-----------------|

### Testimonial Framework
{Questions to ask customers for story-aligned testimonials}
```

---

## Veto Conditions

- NEVER make the brand the hero — the customer is always the hero
- NEVER skip the internal problem — most purchases are driven by internal feelings, not external issues
- NEVER present a plan with more than 3 steps — simplicity is trust
- NEVER write a brand story without stakes (failure) — no stakes, no urgency
- NEVER forget the transitional CTA — not everyone is ready for the direct ask

---

## Completion Criteria

- [ ] All 7 SB7 elements defined
- [ ] One-liner written and memorable
- [ ] Brand narrative written (2-3 paragraphs)
- [ ] Elevator pitch created (60 seconds)
- [ ] Website wireframe copy provided
- [ ] Story applied to key touchpoints
- [ ] Testimonial framework included
