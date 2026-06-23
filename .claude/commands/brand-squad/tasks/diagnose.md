---
task: diagnose()
responsavel: "@brand-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: request
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: Diagnosis Report
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Request parsed and brand domain identified"
  - "[ ] Routing catalog consulted with scored results"
  - "[ ] Quick answer provided with specialist routing"
---

# Task: Diagnose Brand Challenge

**Task ID:** BRAND-CHIEF-001
**Version:** 1.0.0
**Command:** `*diagnose`
**Orchestrator:** Brand Chief (brand-chief)
**Purpose:** Triage brand challenges, provide quick answer, route to specialist.

---

## Overview

```
User Request → Parse Keywords → Match Routing Catalog → Answer/Route → Output
     │              │                    │                     │
     ▼              ▼                    ▼                     ▼
  Raw input   Extract brand        Score domains         Quick answer +
              challenge type     against 13 domains     specialist route
              + maturity stage   + maturity routing     (maturity-aware)
```

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| request | string | User prompt | Yes | Non-empty brand-related description |
| context | object | Session state | No | Company stage, industry, existing brand assets |
| maturity | string | User prompt | No | pre-launch, startup, growth, enterprise, luxury |

---

## Preconditions

- Brand Squad is active with Brand Chief as entry agent
- Routing catalog loaded from data/routing-catalog.yaml
- All 14 specialist agents registered in config.yaml
- Brand maturity routing available for stage-aware triage

---

## Execution Phases

### Phase 1: Analyze Request

1. Parse the user's brand challenge
2. Extract primary keywords and intent
3. Identify the brand domain (equity, identity, positioning, messaging, architecture, naming, etc.)
4. Identify brand maturity stage if mentioned (pre-launch, startup, growth, enterprise, luxury)
5. Note if request involves a known tension (differentiation vs distinctiveness, emotional vs evidence)

### Phase 2: Match Against Routing Catalog

| Domain | Keywords | Route To |
|--------|----------|----------|
| Brand Equity | brand equity, brand value, loyalty, awareness, associations | david-aaker / kevin-keller |
| Brand Identity | brand identity, identity prism, DNA, personality, culture | jean-noel-kapferer / alina-wheeler |
| Positioning | positioning, category, focus, differentiation, own a word | al-ries / marty-neumeier |
| Evidence-Based | how brands grow, mental availability, distinctive assets, reach | byron-sharp / kevin-keller |
| Messaging | StoryBrand, messaging, one-liner, brand script, clarify message | donald-miller / miller-sticky-brand |
| Visual Identity | logo, visual identity, brand guidelines, design system, touchpoints | alina-wheeler / archetype-consultant |
| Brand Culture | brand culture, employer brand, internal brand, fusion | denise-yohn / donald-miller |
| Startup Brand | startup brand, DTC, launch brand, brand from day one, new brand | emily-heyward / marty-neumeier |
| Luxury Brand | luxury, premium, prestige, luxury strategy, anti-laws | jean-noel-kapferer / david-aaker |
| Naming | naming, brand name, rename, name generation, domain | naming-strategist / domain-scout |
| Archetype | archetype, brand personality, character, Jung, hero, rebel | archetype-consultant / jean-noel-kapferer |
| Brand Architecture | brand architecture, sub-brands, branded house, house of brands, portfolio | david-aaker / kevin-keller |
| Differentiation Debate | differentiation vs distinctiveness, zag, radical differentiation | marty-neumeier / byron-sharp |

**Brand maturity shortcut routing:**
- Pre-launch --> emily-heyward, naming-strategist, domain-scout
- Startup --> emily-heyward, marty-neumeier, donald-miller
- Growth --> david-aaker, al-ries, kevin-keller
- Enterprise --> jean-noel-kapferer, denise-yohn, david-aaker
- Luxury --> jean-noel-kapferer, david-aaker, alina-wheeler

**Scoring rules:**
- Count keyword matches per domain
- 2+ matches above others --> route to that domain's primary specialist
- Maturity stage + domain match --> refine routing using maturity shortcut
- Tie or cross-domain --> Brand Chief answers with multi-framework synthesis
- No clear match --> ask about brand maturity stage and primary challenge

### Phase 3a: Cross-Cutting Answer

If request is general or cross-domain:
- Synthesize answer drawing from multiple brand frameworks
- Note relevant tensions (differentiation vs distinctiveness, emotional vs evidence)
- Reference which specialists could go deeper

### Phase 3b: Domain-Specific Route

If request maps clearly to a domain:
1. **Quick answer first** (3-5 lines minimum + framework reference)
2. **Route:** Name the specialist, explain their unique framework, provide activation command
   - Example: "For brand positioning, Al Ries literally wrote the book. Activate with `@brand-squad:al-ries`"

### Phase 4: Confidence Assessment

| Confidence | Criteria | Action |
|------------|----------|--------|
| HIGH | 3+ keyword matches in one domain | Route with confidence to primary specialist |
| MEDIUM | 1-2 matches or split across 2 domains | Answer + suggest 2 specialists |
| LOW | No clear match or very vague | Answer directly, ask about maturity stage and challenge |

---

## Output Format

```markdown
## Diagnosis
**Category:** {domain | cross-cutting}
**Confidence:** {HIGH | MEDIUM | LOW}
**Brand Maturity:** {pre-launch | startup | growth | enterprise | luxury | unknown}
**Specialist:** {Name} ({agent-id}) | Direct Answer

### Quick Answer
{3-10 line answer with brand framework reference}

### Recommended Next Step
{Route instruction with activation command, or follow-up question}
```

---

## Veto Conditions

- NEVER route without providing a quick answer first
- NEVER route when confidence is LOW — answer directly and ask clarifying questions
- NEVER load a specialist agent file during diagnosis
- NEVER ignore the differentiation vs distinctiveness tension when both domains match
- NEVER assume brand maturity stage without explicit signals

---

## Completion Criteria

- [ ] Request parsed and keywords extracted
- [ ] Brand domain identified (or clarification requested)
- [ ] Routing catalog consulted with scored results
- [ ] Quick answer provided with framework reference
- [ ] Specialist routing provided (if domain-specific)
- [ ] Confidence level stated
