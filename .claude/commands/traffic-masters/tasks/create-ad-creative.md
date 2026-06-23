---
task: createAdCreative()
responsavel: "@ad-midas"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: platform
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: adCreativePackage
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Concepts developed with distinct angles"
  - "[ ] Each concept includes hook, copy, visual direction, and CTA"
  - "[ ] Testing framework defined with pairs and metrics"
---

# Task: Create Ad Creative

**Task ID:** TRAFFIC-004
**Version:** 1.0.0
**Command:** `*create-ad-creative`
**Agent:** Ad Midas (ad-midas) or Creative Analyst (creative-analyst)
**Purpose:** Develop ad creative concepts with hooks, copy, visual direction, and testing plan.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Product/service being advertised |
| platform | enum | User prompt | Yes | facebook, instagram, youtube, tiktok, google, linkedin |
| audience | string | User prompt | Yes | Target audience for the creative |
| funnel_stage | enum | User prompt | Yes | cold, warm, hot |
| format | enum | User prompt | No | image, video, carousel, UGC — defaults to platform best practice |
| num_concepts | number | User prompt | No | Defaults to 5 concepts |
| brand_guidelines | string | User prompt | No | Colors, fonts, tone constraints |

---

## Preconditions

- Platform selected with format constraints understood
- Audience defined with emotional triggers identified
- Funnel stage determines the messaging angle

---

## Execution Phases

### Phase 1: Creative Research
1. Analyze the winning creative patterns for the platform:
   - What format dominates (static, video, UGC)?
   - What hook styles perform (question, shock, result, story)?
   - What visual styles attract (clean, raw, text-heavy, cinematic)?
2. Study the audience's content consumption habits on the platform
3. Identify competitor creative patterns (what to differentiate from)
4. Map the creative to the funnel stage messaging:
   - Cold: Curiosity, problem awareness, entertainment value
   - Warm: Proof, education, differentiation, trust building
   - Hot: Offer, urgency, testimonials, direct CTA

### Phase 2: Concept Development
1. Develop creative concepts using distinct angles:
   - **Problem-Agitation:** Show the pain they experience
   - **Before/After:** Visual or narrative transformation
   - **Social Proof:** Testimonial or result-based
   - **Educational:** Teach something valuable, CTA is the next step
   - **Pattern Interrupt:** Unexpected visual or statement that breaks scroll
2. For each concept provide:
   - Hook (first 2-3 seconds for video, headline for image)
   - Core message (the single takeaway)
   - Visual direction (shot list, layout, color, style)
   - Copy (primary text, headline, description per platform specs)
   - CTA (button text and action)
3. Vary formats within the concept batch
4. Ensure at least one UGC-style concept (for social platforms)

### Phase 3: Production Briefs
1. Write production-ready briefs for each concept:
   - For video: Shot list, script, duration, music direction
   - For image: Layout description, text overlay, imagery direction
   - For carousel: Card-by-card breakdown with hook progression
2. Specify dimensions and format requirements per platform
3. Note any text overlay limits (Facebook 20% rule legacy, etc.)
4. Provide reference examples or mood boards where helpful

### Phase 4: Testing Framework
1. Define what is being tested per concept:
   - Hook test: Same body, different hooks
   - Format test: Same message, different formats
   - Angle test: Same audience, different approaches
2. Recommend testing pairs (which 2 concepts to test first)
3. Define success metrics per concept
4. Set the minimum budget and duration for statistical significance

---

## Output Format

```markdown
## Ad Creative Package: {Product}

**Platform:** {platform}
**Audience:** {audience}
**Funnel Stage:** {stage}
**Concepts:** {count}

---

### Concept 1: {Name} — {Angle}
**Format:** {format}
**Hook:** {first 2-3 seconds or headline}
**Core Message:** {single takeaway}

**Copy:**
- Primary Text: {body copy}
- Headline: {headline}
- Description: {description}
- CTA: {button text}

**Visual Direction:**
{Shot list, layout, or imagery description}

**Production Notes:**
{Specs, dimensions, duration, special requirements}

---

### Concept 2-N: ...

---

### Testing Plan

| Test | Concept A | Concept B | Variable | Budget | Duration |
|------|-----------|-----------|----------|--------|----------|

### Platform Specs Checklist
| Spec | Requirement | Status |
|------|------------|--------|
```

---

## Veto Conditions

- NEVER create ads without specifying the platform — constraints shape the creative
- NEVER use the same angle for all concepts — variety is the point of testing
- NEVER write video scripts without a hook in the first 3 seconds
- NEVER ignore platform-specific format requirements
- NEVER skip the testing plan — creative without testing is guessing

---

## Completion Criteria

- [ ] Platform creative patterns researched
- [ ] Concepts developed with distinct angles
- [ ] Each concept includes hook, copy, visual direction, and CTA
- [ ] Production briefs written for all concepts
- [ ] Testing framework defined with pairs and metrics
- [ ] Platform specs verified for all formats
