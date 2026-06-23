---
task: buildIdentity()
responsavel: "@alina-wheeler"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: brand
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: positioning
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: Brand Identity System
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Visual identity system defined (colors, typography, logo)"
  - "[ ] Verbal identity system defined (voice, messaging, story)"
  - "[ ] Brand guidelines summary compiled with application examples"
---

# Task: Build Brand Identity

**Task ID:** BRAND-003
**Version:** 1.0.0
**Command:** `*build-identity`
**Agent:** Alina Wheeler (alina-wheeler) or Jean-Noel Kapferer (jean-noel-kapferer)
**Purpose:** Design a comprehensive visual and verbal identity system for the brand.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| brand | string | User prompt | Yes | Brand name |
| positioning | string | User prompt | Yes | Positioning statement (ideally from create-positioning.md) |
| audience | string | User prompt | Yes | Target audience with psychographic detail |
| industry | string | User prompt | Yes | Industry context |
| brand_personality | list | User prompt | No | Desired personality traits (3-5) |
| existing_assets | list | User prompt | No | Current logo, colors, fonts to preserve or replace |
| archetype | string | User prompt | No | Brand archetype if already determined |

---

## Preconditions

- Positioning defined (what the brand stands for)
- Target audience identified with emotional and aspirational context

---

## Execution Phases

### Phase 1: Brand Personality Definition
1. Define 5 personality traits using the brand personality spectrum:
   - Sincerity: honest, wholesome, cheerful, down-to-earth
   - Excitement: daring, spirited, imaginative, up-to-date
   - Competence: reliable, intelligent, successful, leader
   - Sophistication: upper-class, charming, elegant, premium
   - Ruggedness: outdoorsy, tough, authentic, no-nonsense
2. For each trait, define what it looks like in practice:
   - How the brand speaks (tone of voice)
   - How the brand looks (visual style)
   - How the brand behaves (customer experience)
3. Define the anti-personality — what the brand is NOT
4. Write a "brand as a person" description (if the brand were a person at a dinner party)

### Phase 2: Visual Identity System
1. Define the color system:
   - Primary color: The dominant brand color (with hex, RGB, CMYK values)
   - Secondary colors: 2-3 complementary colors
   - Neutral colors: Backgrounds, text, and UI colors
   - Color psychology rationale for each choice
2. Define the typography system:
   - Primary typeface: For headlines and brand moments
   - Secondary typeface: For body text and long-form
   - Web-safe fallbacks
   - Usage rules (sizing hierarchy, weight usage)
3. Define the logo direction:
   - Logo concept description (what it represents)
   - Logo variations needed (primary, secondary, icon-only, monochrome)
   - Clear space and minimum size rules
   - Backgrounds the logo works on (and doesn't)
4. Define the visual style:
   - Photography style (bright, moody, lifestyle, product, candid)
   - Illustration style (if applicable)
   - Iconography style
   - Layout principles and grid preferences

### Phase 3: Verbal Identity System
1. Define the brand voice:
   - Tone dimensions (formal/casual, serious/playful, respectful/irreverent, enthusiastic/matter-of-fact)
   - Voice dos and don'ts with examples
   - Vocabulary preferences (words to use, words to avoid)
2. Write key messaging frameworks:
   - Tagline / slogan
   - Brand promise (one sentence)
   - Brand story (origin narrative, 2-3 paragraphs)
   - Mission statement
   - Vision statement
   - Value propositions by audience segment
3. Create a messaging hierarchy:
   - Level 1: What we always say (core messages)
   - Level 2: What we say when relevant (supporting messages)
   - Level 3: What we never say (off-limits topics)

### Phase 4: Brand Guidelines Summary
1. Compile the identity system into a structured guidelines document
2. Provide usage examples for common applications:
   - Business card
   - Social media profile
   - Email signature
   - Website header
   - Ad template
3. Define the governance rules:
   - Who can modify brand assets
   - Approval process for new applications
   - Annual review cadence

---

## Output Format

```markdown
## Brand Identity System: {Brand Name}

**Positioning:** {statement}
**Personality:** {5 traits}
**Archetype:** {archetype}

---

### Brand Personality

| Trait | Expression | Anti-Trait |
|-------|-----------|-----------|

**Brand as a Person:** {description}

### Visual Identity

#### Colors
| Role | Color | Hex | Psychology |
|------|-------|-----|-----------|
| Primary | {color} | #{hex} | {rationale} |

#### Typography
| Role | Typeface | Weight | Usage |
|------|---------|--------|-------|

#### Logo Direction
{Concept description with variation requirements}

#### Visual Style
{Photography, illustration, and layout direction}

### Verbal Identity

#### Brand Voice
| Dimension | Position | Example |
|-----------|----------|---------|

#### Key Messaging
- **Tagline:** {tagline}
- **Brand Promise:** {promise}
- **Mission:** {mission}
- **Vision:** {vision}

#### Brand Story
{2-3 paragraph origin narrative}

### Application Examples
{Description of how the identity applies to key touchpoints}

### Governance
{Who, what, when for brand management}
```

---

## Veto Conditions

- NEVER design identity without a positioning foundation — identity expresses positioning
- NEVER choose colors or fonts based solely on personal preference — justify with strategy
- NEVER define voice without examples — abstract descriptions are unusable
- NEVER create an identity system too complex to be consistently applied
- NEVER skip the "anti-personality" — knowing what you are NOT is as important as what you are

---

## Completion Criteria

- [ ] Brand personality defined with 5 traits and anti-traits
- [ ] Color system defined with rationale
- [ ] Typography system defined with usage rules
- [ ] Logo direction documented with variation needs
- [ ] Visual style defined (photography, illustration, layout)
- [ ] Brand voice defined with dos, don'ts, and examples
- [ ] Key messaging written (tagline, promise, story, mission, vision)
- [ ] Application examples provided
- [ ] Governance rules defined
