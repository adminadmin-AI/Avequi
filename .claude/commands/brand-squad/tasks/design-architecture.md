---
task: designArchitecture()
responsavel: "@david-aaker"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: parent_brand
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: products
    tipo: list
    origem: User Input
    obrigatorio: true

Saida:
  - campo: Brand Architecture Map
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Architecture model selected with scored rationale"
  - "[ ] All products/services mapped into the architecture"
  - "[ ] Governance framework established"
---

# Task: Design Brand Architecture

**Task ID:** BRAND-005
**Version:** 1.0.0
**Command:** `*design-architecture`
**Agent:** David Aaker (david-aaker)
**Purpose:** Design the brand architecture strategy for multi-product or multi-brand organizations.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| parent_brand | string | User prompt | Yes | Parent or master brand name |
| products | list | User prompt | Yes | All products, services, or sub-brands |
| market_context | string | User prompt | Yes | Industry and competitive landscape |
| audience_segments | list | User prompt | No | Different audience groups served |
| growth_plans | string | User prompt | No | Planned new products or market expansions |
| current_architecture | string | User prompt | No | Existing brand structure if any |

---

## Preconditions

- Multiple products, services, or brands exist (or are planned)
- Need to organize them into a coherent structure

---

## Execution Phases

### Phase 1: Architecture Model Selection
1. Evaluate the 4 brand architecture models:
   - **Branded House:** One master brand, all products live under it
     - Example: Google (Google Maps, Google Drive, Google Photos)
     - Best when: Strong parent brand, related products, shared audience
   - **House of Brands:** Independent brands, parent is invisible
     - Example: P&G (Tide, Pampers, Gillette — all separate)
     - Best when: Products serve different audiences or could conflict
   - **Endorsed Brands:** Sub-brands endorsed by the parent
     - Example: Marriott (Courtyard by Marriott, Residence Inn by Marriott)
     - Best when: Sub-brands need independence but benefit from parent credibility
   - **Hybrid:** Mix of models across the portfolio
     - Example: Amazon (Amazon Prime = branded house, Ring = endorsed, Whole Foods = house of brands)
     - Best when: Portfolio is diverse with varying strategic needs
2. Score each model against the brand's specific context
3. Recommend the primary model with rationale

### Phase 2: Architecture Design
1. Map every product/service/sub-brand into the chosen architecture
2. Define the naming strategy:
   - Descriptive names (Google Maps) — clear but less distinctive
   - Suggestive names (Amazon Prime) — implies benefit
   - Abstract names (Alexa) — distinctive but requires investment
   - Alphanumeric (iPhone 15) — versioning and hierarchy
3. Define the visual relationship between parent and sub-brands:
   - Logo lockup rules (how logos appear together)
   - Color strategy (shared palette vs distinct per sub-brand)
   - Typography relationship
4. Define the verbal relationship:
   - How sub-brands reference the parent in copy
   - Tagline strategy (shared vs individual)
   - Voice consistency rules

### Phase 3: Role Assignment
1. Assign a strategic role to each brand in the portfolio:
   - **Master Brand:** The primary source of equity and trust
   - **Cash Cow:** Established brand that funds growth
   - **Star:** High-growth brand that drives the future
   - **Fighter:** Brand that competes on price to protect premium brands
   - **Flanker:** Brand that extends into an adjacent market
   - **Silver Bullet:** Brand that enhances the parent's image
2. Define the investment priority for each brand role
3. Identify brands to sunset, merge, or divest
4. Map the portfolio's coverage of audience segments

### Phase 4: Migration and Governance
1. If changing from current architecture, define the migration plan:
   - Phase 1: What changes immediately
   - Phase 2: What transitions over 6-12 months
   - Phase 3: What is the final steady state
2. Define the governance framework:
   - Who approves new sub-brands
   - Criteria for adding a new brand vs extending existing
   - Naming convention rules for future additions
   - Brand hierarchy decision tree
3. Document the anti-dilution rules:
   - Maximum number of sub-brands before confusion
   - Minimum differentiation required between sub-brands
   - When to merge overlapping brands

---

## Output Format

```markdown
## Brand Architecture: {Parent Brand}

**Model:** {branded-house / house-of-brands / endorsed / hybrid}
**Total Brands:** {count}
**Architecture Clarity Score:** {X}/10

---

### Architecture Map

{Visual text representation of the brand hierarchy}

### Brand Portfolio

| Brand | Role | Relationship to Parent | Audience | Status |
|-------|------|----------------------|----------|--------|
| {brand} | {role} | {master/endorsed/independent} | {segment} | {active/planned/sunset} |

### Naming Strategy
**Convention:** {descriptive / suggestive / abstract}
**Rules:** {naming guidelines for new additions}

### Visual Relationship
| Element | Parent | Sub-Brand A | Sub-Brand B |
|---------|--------|------------|------------|
| Logo | {rule} | {rule} | {rule} |
| Colors | {rule} | {rule} | {rule} |
| Typography | {rule} | {rule} | {rule} |

### Migration Plan (if applicable)
| Phase | Timeline | Changes |
|-------|----------|---------|

### Governance Rules
- New brand approval: {process}
- Extend vs create decision: {criteria}
- Maximum portfolio size: {N}
- Review cadence: {frequency}

### Portfolio Gaps
{Audience segments or markets not currently covered}
```

---

## Veto Conditions

- NEVER design architecture without understanding the full product portfolio
- NEVER choose a model based on aesthetics — it must serve business strategy
- NEVER create more sub-brands than the market can differentiate
- NEVER migrate all brands at once — phase the transition
- NEVER skip governance — without rules, the architecture will decay

---

## Completion Criteria

- [ ] Architecture model selected with scored rationale
- [ ] All products/services mapped into the architecture
- [ ] Naming strategy defined with conventions
- [ ] Visual and verbal relationships documented
- [ ] Strategic roles assigned to each brand
- [ ] Migration plan created (if changing architecture)
- [ ] Governance framework established
- [ ] Portfolio gaps identified
