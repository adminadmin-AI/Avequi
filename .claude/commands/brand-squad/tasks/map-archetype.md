---
task: mapArchetype()
responsavel: "@archetype-consultant"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: brand
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: brand_values
    tipo: list
    origem: User Input
    obrigatorio: true

Saida:
  - campo: Brand Archetype Profile
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] All 12 archetypes evaluated and top 3 scored"
  - "[ ] Primary and secondary archetypes selected"
  - "[ ] Application examples provided for 5+ touchpoints"
---

# Task: Map Brand Archetype

**Task ID:** BRAND-007
**Version:** 1.0.0
**Command:** `*map-archetype`
**Agent:** Archetype Consultant (archetype-consultant)
**Purpose:** Identify and apply the brand's Jungian archetype to guide personality, messaging, and experience.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| brand | string | User prompt | Yes | Brand name and description |
| audience | string | User prompt | Yes | Target audience and their aspirations |
| brand_values | list | User prompt | Yes | Core values and beliefs |
| industry | string | User prompt | No | Industry context |
| competitors | list | User prompt | No | Competitors with their perceived archetypes |
| current_perception | string | User prompt | No | How the brand is currently perceived |

---

## Preconditions

- Brand values articulated (even informally)
- Understanding of what the audience aspires to

---

## Execution Phases

### Phase 1: Archetype Analysis
1. Evaluate the brand against all 12 archetypes:
   - **Innocent:** Optimism, simplicity, purity (Dove, Coca-Cola)
   - **Explorer:** Freedom, discovery, adventure (Jeep, Patagonia)
   - **Sage:** Wisdom, knowledge, truth (Google, BBC)
   - **Hero:** Courage, mastery, achievement (Nike, FedEx)
   - **Outlaw:** Liberation, revolution, disruption (Harley-Davidson, Virgin)
   - **Magician:** Transformation, vision, imagination (Apple, Disney)
   - **Regular Guy:** Belonging, authenticity, connection (IKEA, Target)
   - **Lover:** Intimacy, passion, beauty (Chanel, Godiva)
   - **Jester:** Joy, humor, living in the moment (Old Spice, M&Ms)
   - **Caregiver:** Service, compassion, nurturing (Johnson & Johnson, TOMS)
   - **Creator:** Innovation, self-expression, originality (LEGO, Adobe)
   - **Ruler:** Control, authority, leadership (Mercedes, Rolex)
2. Score top 3 archetypes by fit (1-10 on values alignment, audience resonance, competitive differentiation)
3. Identify the primary archetype and secondary influence
4. Validate against competitor archetypes to ensure differentiation

### Phase 2: Archetype Expression Guide
1. Define how the primary archetype manifests in the brand:
   - **Core Desire:** What the archetype fundamentally wants
   - **Goal:** What the archetype is trying to achieve
   - **Fear:** What the archetype avoids
   - **Strategy:** How the archetype approaches challenges
   - **Gift:** What the archetype offers the world
   - **Shadow:** The dark side to avoid (archetype taken too far)
2. Translate the archetype into brand expressions:
   - Tone of voice: How the brand speaks
   - Visual mood: How the brand looks and feels
   - Story themes: What stories the brand tells
   - Customer relationship: How the brand treats customers
   - Content themes: What topics the brand covers

### Phase 3: Messaging Through Archetype Lens
1. Write archetype-aligned messaging:
   - Tagline: Captures the archetype's essence
   - Brand promise: Framed through the archetype's values
   - Key messages: 3-5 messages that embody the archetype
   - Social media voice: How the archetype shows up in daily content
2. Create the archetype-based content strategy:
   - Content themes that resonate with the archetype
   - Story structures that align (hero's journey, discovery, transformation)
   - Emotional triggers to leverage
   - Emotional triggers to avoid
3. Provide competitor archetype differentiation:
   - Where competitors occupy similar archetypes
   - How to express the same archetype differently
   - Where the secondary archetype creates uniqueness

### Phase 4: Application Examples
1. Write 3-5 examples of the archetype in action:
   - Homepage headline
   - Email subject line
   - Social media post
   - Customer support response
   - Error message or 404 page
2. Provide "what would {archetype} do?" decision framework
3. Create the archetype cheat sheet for the team:
   - When making brand decisions, ask: "Would a {archetype} say/do this?"
   - Quick reference for dos and don'ts

---

## Output Format

```markdown
## Brand Archetype: {Brand Name}

**Primary Archetype:** {archetype}
**Secondary Influence:** {archetype}
**Archetype Blend:** {X}% {primary} + {Y}% {secondary}

---

### Archetype Scorecard

| Archetype | Values Fit | Audience Fit | Differentiation | Total |
|-----------|-----------|-------------|-----------------|-------|
| {top 1} | X/10 | X/10 | X/10 | XX/30 |
| {top 2} | X/10 | X/10 | X/10 | XX/30 |
| {top 3} | X/10 | X/10 | X/10 | XX/30 |

### Archetype Profile

| Element | Definition |
|---------|-----------|
| Core Desire | {desire} |
| Goal | {goal} |
| Fear | {fear} |
| Strategy | {strategy} |
| Gift | {gift} |
| Shadow | {what to avoid} |

### Brand Expression Guide

| Dimension | Direction | Example |
|-----------|----------|---------|
| Tone of Voice | {description} | {example phrase} |
| Visual Mood | {description} | {reference} |
| Story Themes | {themes} | {example} |
| Customer Relationship | {style} | {example} |

### Archetype-Aligned Messaging
- **Tagline:** {tagline}
- **Promise:** {brand promise}
- **Key Messages:** {3-5 messages}

### Application Examples
| Touchpoint | Example |
|-----------|---------|
| Homepage headline | {copy} |
| Email subject | {copy} |
| Social post | {copy} |
| Support response | {copy} |

### Team Cheat Sheet
**Always ask:** "Would a {archetype} say/do this?"
**Do:** {list}
**Don't:** {list}
```

---

## Veto Conditions

- NEVER assign an archetype without evaluating all 12 — bias leads to mistyping
- NEVER ignore the shadow side — every archetype has a dark version to avoid
- NEVER assign the same archetype as the dominant competitor without a differentiation strategy
- NEVER recommend more than 2 archetype influences — brands with 3+ archetypes feel confused
- NEVER skip application examples — abstract archetype theory is unusable without concrete demonstration

---

## Completion Criteria

- [ ] All 12 archetypes evaluated
- [ ] Top 3 scored with rationale
- [ ] Primary and secondary archetypes selected
- [ ] Archetype expression guide completed
- [ ] Messaging written through archetype lens
- [ ] Application examples provided for 5+ touchpoints
- [ ] Team cheat sheet created
- [ ] Shadow side documented as guardrail
