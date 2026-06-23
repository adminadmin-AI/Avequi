---
task: auditBrand()
responsavel: "@brand-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: brand
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: industry
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: Brand Health Report
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Brand equity scored across 5 Aaker pillars"
  - "[ ] Identity assessed across 6 Kapferer facets"
  - "[ ] Prioritized recommendations with specialist routing"
---

# Task: Audit Brand

**Task ID:** BRAND-001
**Version:** 1.0.0
**Command:** `*audit-brand`
**Agent:** Brand Chief (brand-chief) or David Aaker (david-aaker)
**Purpose:** Comprehensive brand health audit assessing equity, positioning, identity, and market perception.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| brand | string | User prompt | Yes | Brand name and brief description |
| industry | string | User prompt | Yes | Industry and market context |
| brand_assets | list | User prompt | No | Logo, website, social profiles, marketing materials |
| competitors | list | User prompt | No | Key competitors for positioning context |
| audience | string | User prompt | No | Target audience description |
| brand_age | string | User prompt | No | How long the brand has existed |
| known_issues | string | User prompt | No | Self-identified brand challenges |

---

## Preconditions

- Brand exists with some market presence (even minimal)
- At least basic brand assets available for review

---

## Execution Phases

### Phase 1: Brand Equity Assessment (Aaker Model)
1. Evaluate the 5 pillars of brand equity:
   - **Brand Awareness:** Recognition and recall level in target market
   - **Perceived Quality:** How the audience rates quality vs competitors
   - **Brand Associations:** What comes to mind when people hear the brand name
   - **Brand Loyalty:** Repeat purchase rate, advocacy, switching resistance
   - **Proprietary Assets:** Trademarks, patents, distribution channels
2. Score each pillar (1-10)
3. Identify the strongest and weakest pillars
4. Benchmark against competitors where data available

### Phase 2: Identity Assessment (Kapferer Prism)
1. Evaluate the 6 facets of brand identity:
   - **Physique:** Visual elements, logo, colors, packaging, product design
   - **Personality:** Character traits, voice, tone, human qualities
   - **Culture:** Values, origin story, belief system
   - **Relationship:** How the brand relates to its customers
   - **Reflection:** How customers see themselves through the brand
   - **Self-image:** How customers feel internally when using the brand
2. Identify inconsistencies between facets
3. Assess alignment between internal identity and external perception
4. Note any facets that are undefined or contradictory

### Phase 3: Positioning Analysis
1. Evaluate current positioning:
   - What category does the brand compete in?
   - What is the primary point of differentiation?
   - Is the positioning clear, credible, and compelling?
2. Map the competitive landscape:
   - Where does each competitor position themselves?
   - Where are the open positions (white space)?
   - Is the brand in a crowded or uncrowded position?
3. Test positioning clarity: Can someone describe what makes this brand different in one sentence?

### Phase 4: Touchpoint and Consistency Audit
1. Review brand consistency across touchpoints:
   - Visual identity: logo usage, colors, typography
   - Verbal identity: messaging, tone, key phrases
   - Digital presence: website, social media, email
   - Customer experience: support, onboarding, packaging
2. Identify inconsistencies and gaps
3. Score overall brand coherence (1-10)
4. Provide a prioritized fix list

---

## Output Format

```markdown
## Brand Audit: {Brand Name}

**Industry:** {industry}
**Brand Age:** {age}
**Overall Brand Health Score:** {X}/100
**Verdict:** {Critical / Needs Work / Healthy / Strong / Premium}

---

### Brand Equity Scorecard (Aaker)

| Pillar | Score | Strengths | Gaps |
|--------|-------|-----------|------|
| Awareness | X/10 | {note} | {note} |
| Perceived Quality | X/10 | {note} | {note} |
| Associations | X/10 | {note} | {note} |
| Loyalty | X/10 | {note} | {note} |
| Proprietary Assets | X/10 | {note} | {note} |

### Identity Prism (Kapferer)

| Facet | Current State | Consistency | Issue |
|-------|--------------|-------------|-------|
| Physique | {description} | {aligned/misaligned} | {note} |
| Personality | {description} | {aligned/misaligned} | {note} |
| Culture | {description} | {aligned/misaligned} | {note} |
| Relationship | {description} | {aligned/misaligned} | {note} |
| Reflection | {description} | {aligned/misaligned} | {note} |
| Self-image | {description} | {aligned/misaligned} | {note} |

### Positioning Map
**Current Position:** {description}
**Differentiation:** {clear/unclear}
**White Space Opportunities:** {identified gaps}
**Competitive Overlap:** {where you collide with competitors}

### Consistency Score
**Overall Coherence:** {X}/10
**Strongest Touchpoint:** {touchpoint}
**Weakest Touchpoint:** {touchpoint}

### Prioritized Recommendations
| Priority | Area | Issue | Recommended Fix | Agent |
|----------|------|-------|-----------------|-------|
| 1 | {area} | {issue} | {fix} | {specialist} |

### What to Protect
{Elements that are working well and must be preserved}
```

---

## Veto Conditions

- NEVER audit without reviewing actual brand assets — theory without observation is guessing
- NEVER score without providing specific evidence for each rating
- NEVER ignore competitor context — brand strength is always relative
- NEVER provide only criticism — identify and protect what works
- NEVER recommend changing everything at once — prioritize ruthlessly

---

## Completion Criteria

- [ ] Brand equity scored across 5 Aaker pillars
- [ ] Identity assessed across 6 Kapferer facets
- [ ] Positioning analyzed with competitive context
- [ ] Touchpoint consistency audited
- [ ] Overall health score calculated
- [ ] Prioritized recommendations with specialist routing
- [ ] Strengths identified and flagged for protection
