---
task: writeHeadline()
responsavel: "@eugene-schwartz"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: awareness_level
    tipo: enum
    origem: User Input
    obrigatorio: true

Saida:
  - campo: headline_package
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Awareness level confirmed or diagnosed"
  - "[ ] 10 headline variations generated using 3+ formulas"
  - "[ ] Top 5 ranked with scoring on 4 dimensions"
---

# Task: Write Headline

**Task ID:** COPY-001
**Version:** 1.0.0
**Command:** `*write-headline`
**Agent:** Eugene Schwartz (eugene-schwartz) or Gary Bencivenga (gary-bencivenga)
**Purpose:** Create compelling headlines calibrated to the prospect's awareness level.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Product or service name with brief description |
| audience | string | User prompt | Yes | Target audience description |
| awareness_level | enum | User prompt or inferred | Yes | unaware, problem-aware, solution-aware, product-aware, most-aware |
| medium | string | User prompt | No | Where headline appears (ad, email, sales page, VSL) |
| tone | string | User prompt | No | Desired tone (urgent, curious, authoritative, empathetic) |
| swipe_reference | string | User prompt | No | Reference headline or style to emulate |

---

## Preconditions

- Product or service clearly defined
- Target audience identified with at least basic demographics or psychographics
- Awareness level determined (if not provided, agent must diagnose before writing)

---

## Execution Phases

### Phase 1: Awareness Diagnosis
1. Confirm the prospect's awareness level using Schwartz's 5-level scale
2. Identify the dominant emotion driving the prospect (fear, desire, curiosity, frustration)
3. Map awareness level to headline approach:
   - Unaware: Lead with emotion or story, never mention product
   - Problem-aware: Agitate the problem, hint at solution
   - Solution-aware: Differentiate the mechanism or approach
   - Product-aware: Stack proof, overcome objections
   - Most-aware: Lead with offer, urgency, or deal

### Phase 2: Headline Generation
1. Generate 10 headline variations using distinct angles
2. Apply at least 3 different headline formulas per batch:
   - How-to headlines
   - Question headlines
   - Command headlines
   - Reason-why headlines
   - Testimonial headlines
   - News/announcement headlines
   - Curiosity-gap headlines
   - Specific-number headlines
3. Ensure each headline passes the "would I stop scrolling?" test
4. Vary length: include short (under 8 words), medium (8-15), and long (15+)

### Phase 3: Refinement and Ranking
1. Score each headline on 4 dimensions (1-5 each):
   - Specificity: Does it promise a concrete outcome?
   - Curiosity: Does it create an open loop?
   - Relevance: Does it match the awareness level?
   - Believability: Is the claim credible?
2. Rank top 5 by total score
3. Provide A/B testing recommendations for the top 2
4. Suggest sub-headline pairings for the top 3

---

## Output Format

```markdown
## Headline Package

**Product:** {product}
**Audience:** {audience}
**Awareness Level:** {level}

### Top 5 Headlines (Ranked)

| Rank | Headline | Formula | Specificity | Curiosity | Relevance | Believability | Total |
|------|----------|---------|-------------|-----------|-----------|---------------|-------|
| 1 | {headline} | {formula} | X | X | X | X | XX |

### A/B Test Recommendation
**Control:** {headline 1}
**Variant:** {headline 2}
**Rationale:** {why these two}

### Sub-headline Pairings
1. {headline} + {sub-headline}
2. {headline} + {sub-headline}
3. {headline} + {sub-headline}

### Full 10-Headline Bank
1. {headline} — {formula used}
...
```

---

## Veto Conditions

- NEVER write a headline without first confirming awareness level
- NEVER use clickbait that the body copy cannot deliver on
- NEVER ignore the medium — a Facebook ad headline differs from a sales page headline
- NEVER submit fewer than 10 variations
- NEVER use the product name in headlines for unaware audiences

---

## Completion Criteria

- [ ] Awareness level confirmed or diagnosed
- [ ] 10 headline variations generated using 3+ formulas
- [ ] Each headline scored on 4 dimensions
- [ ] Top 5 ranked with rationale
- [ ] A/B test pair recommended
- [ ] Sub-headline pairings provided for top 3
- [ ] Output formatted per template
