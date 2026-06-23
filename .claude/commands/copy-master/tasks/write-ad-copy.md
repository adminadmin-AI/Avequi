---
task: writeAdCopy()
responsavel: "@dan-kennedy"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: platform
    tipo: enum
    origem: User Input
    obrigatorio: true

Saida:
  - campo: ad_copy_package
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Platform constraints identified and respected"
  - "[ ] 5 ad variations written with distinct angles"
  - "[ ] Testing plan with prioritized pairs provided"
  - "[ ] Psychological Layer applied (Cialdini/Warren principles tagged)"
---

# Task: Write Ad Copy

**Task ID:** COPY-M-005
**Version:** 2.0.0
**Command:** `*write-ad-copy`
**Agent:** Dan Kennedy (dan-kennedy)
**Purpose:** Write direct response ad copy for any paid media platform with layered persuasion psychology.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Product/service with key benefit |
| audience | string | User prompt | Yes | Target audience with platform behavior |
| platform | enum | User prompt | Yes | facebook, instagram, google-search, google-display, youtube, tiktok, linkedin |
| objective | enum | User prompt | Yes | awareness, traffic, leads, sales, retargeting |
| offer | string | User prompt | No | What the ad is driving to (lead magnet, sale, webinar, etc.) |
| budget_context | string | User prompt | No | Spend level — affects volume of variations |
| competitors | list | User prompt | No | Known competitors for differentiation |

---

## Preconditions

- Platform selected with clear understanding of format constraints
- Campaign objective defined
- Landing page or destination exists (or is being built in parallel)

---

## Champion Reference

Study these real-world champion ads before writing:

1. **"The Man in the Hathaway Shirt"** (David Ogilvy) — Eyepatch curiosity device, brand storytelling in a single image + copy
2. **Dollar Shave Club Facebook Ads** — Irreverent tone, problem-agitation, direct CTA, scaled to $1B acquisition
3. **Purple Mattress "Raw Egg Test"** (Harmon Brothers) — Demonstration-driven proof with humor, 185M+ views
4. **Agora Financial Facebook Ads** — Fear + curiosity hooks, "loophole" language, direct response meets social media
5. **Frank Kern's "4 Minute Video" Ads** — Value-first hooks, warm traffic retargeting, conversational direct response

---

## Execution Phases

### Phase 1: Platform-Specific Strategy
1. Define format constraints per platform:
   - Facebook/Instagram: Primary text (125 chars above fold), headline (40 chars), description (30 chars), image/video
   - Google Search: 3 headlines (30 chars each), 2 descriptions (90 chars each)
   - YouTube: Hook in 5 seconds (skippable), 15-30s for non-skip
   - TikTok: Native tone, hook in 2 seconds, 15-60s video script
   - LinkedIn: Professional tone, 150-char intro, headline
2. Identify the platform's native communication style
3. Map the funnel stage to messaging approach:
   - Cold traffic: Lead with problem or curiosity
   - Warm traffic: Lead with proof or mechanism
   - Hot traffic/retarget: Lead with offer and urgency

### Phase 2: Psychological Layer
1. Select primary Cialdini principle per ad variation:
   - Social Proof ad: "Join 10,000+ who already..."
   - Authority ad: "Recommended by Dr. X..."
   - Scarcity ad: "Only 47 spots left..."
   - Reciprocity ad: Free value hook leading to offer
   - Unity ad: "Fellow [identity]..." targeting shared group
2. Apply Blair Warren's levers to ad angles:
   - Encourage dreams angle: "Finally achieve X without Y"
   - Justify failures angle: "It's not your fault — here's why X didn't work"
   - Confirm suspicions angle: "You've always known X was true"
3. Ensure each of the 5 variations uses a different primary psychological driver

### Phase 3: Ad Copy Creation
1. Write 5 ad variations per format using distinct angles:
   - Problem-agitation angle
   - Benefit-first angle
   - Social proof angle
   - Curiosity/news angle
   - Direct offer angle
2. For each variation provide:
   - Primary text / body copy
   - Headline
   - Description / sub-headline
   - CTA button text recommendation
   - Primary Cialdini principle
   - Primary Warren lever
3. Write copy that matches the platform's native tone
4. Ensure each ad can stand alone (no dependency on creative)

### Phase 4: Testing Framework
1. Organize ads into a structured testing plan
2. Recommend which 2 ads to test first and why
3. Define success metrics by platform and objective
4. Suggest creative direction notes for each ad (image/video guidance)
5. Provide retargeting ad variants for non-converters

---

## Output Format

```markdown
## Ad Copy Package: {Product}

**Platform:** {platform}
**Objective:** {objective}
**Audience:** {audience}
**Funnel Stage:** {cold / warm / hot}

---

### Ad Variation 1: {Angle Name}
**Primary Text:** {body copy}
**Headline:** {headline}
**Description:** {description}
**CTA:** {button text}
**Creative Direction:** {image/video guidance}
**Cialdini Principle:** {principle}
**Warren Lever:** {lever}

---

### Ad Variation 2-5: ...

---

### Testing Plan

| Priority | Ad # | Angle | Psych Driver | Test Against | Success Metric |
|----------|------|-------|-------------|-------------|----------------|

### Retargeting Variants
{2-3 retargeting ad variations for non-converters}

### Platform-Specific Notes
{Character limits respected, format compliance, policy considerations}
```

---

## Veto Conditions

- NEVER exceed platform character limits
- NEVER write ads without specifying the platform — format constraints matter
- NEVER use the same angle for all 5 variations
- NEVER ignore platform advertising policies (no exaggerated claims, no prohibited categories)
- NEVER write an ad without a clear CTA

---

## Completion Criteria

- [ ] Platform constraints identified and respected
- [ ] 5 ad variations written with distinct angles
- [ ] Each ad includes all required format elements
- [ ] Testing plan with prioritized pairs
- [ ] Retargeting variants included
- [ ] Creative direction notes provided
- [ ] Platform policy compliance verified
- [ ] Psychological Layer applied — Cialdini principles tagged per ad
- [ ] Blair Warren levers identified per ad variation
