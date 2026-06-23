---
task: writeBullets()
responsavel: "@gary-bencivenga"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: content_source
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: bullet_package
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Source content mined for all bullet material"
  - "[ ] Requested number of bullets written using varied formulas"
  - "[ ] 3-5 killer bullets identified for multi-use"
---

# Task: Write Bullet Points

**Task ID:** COPY-010
**Version:** 1.0.0
**Command:** `*write-bullets`
**Agent:** Gary Bencivenga (gary-bencivenga)
**Purpose:** Write curiosity-driven bullet points (fascinations) that sell without revealing the answer.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| product | string | User prompt | Yes | Product/service with content or features to bullet |
| content_source | string | User prompt | Yes | Raw material to transform into bullets (features, chapters, lessons, results) |
| context | enum | User prompt | Yes | sales-page, email, VSL, ad, order-form |
| audience | string | User prompt | No | Target reader for calibrating language |
| num_bullets | number | User prompt | No | Defaults to 20 |
| style | enum | User prompt | No | fascination, benefit, proof, hybrid — defaults to fascination |

---

## Preconditions

- Source content available (features list, table of contents, lesson outlines, or results data)
- Context for placement defined (bullets for a sales page differ from email bullets)

---

## Execution Phases

### Phase 1: Source Mining
1. Extract every unique claim, feature, benefit, or fact from the source content
2. Identify which facts are most surprising, counterintuitive, or valuable
3. Rank by "would someone pay money just to know this?" factor
4. Group by theme for organized bullet sections
5. Target at least 2x the requested bullet count as raw material

### Phase 2: Bullet Writing
1. Write bullets using proven fascination formulas:
   - **The Secret:** "The closely guarded secret that {outcome}..."
   - **The Counterintuitive:** "Why {common belief} is actually {opposite}..."
   - **The Specific Number:** "{Exact number} ways to {outcome} without {sacrifice}..."
   - **The Question:** "Are you making this ${cost} mistake with your {thing}?"
   - **The Forbidden:** "What {authorities} don't want you to know about {topic}..."
   - **The Proof:** "How {person} achieved {specific result} in {timeframe}..."
   - **The If-Then:** "If you {situation}, here's {solution}..."
   - **The Warning:** "WARNING: Never {action} until you {precaution}..."
2. Apply the Bencivenga specificity rule: vague bullets are dead bullets
3. Each bullet must create an open loop the reader needs to close
4. Vary sentence structure — never use the same formula consecutively
5. Bold or emphasize the most important phrase in longer bullets

### Phase 3: Selection and Ordering
1. Score each bullet on curiosity intensity (1-5)
2. Select the top bullets (per requested count)
3. Order strategically:
   - Start strong (top 2 bullets first)
   - Alternate between emotional and logical bullets
   - End strong (save a powerful bullet for last)
4. Group into themed sections if for a long sales page
5. Mark 3-5 "killer bullets" that could be standalone headlines

---

## Output Format

```markdown
## Bullet Package: {Product Name}

**Context:** {where bullets will appear}
**Style:** {fascination / benefit / proof / hybrid}
**Total Bullets:** {count}

---

### Top Bullets (Killer Headlines)
{3-5 strongest bullets marked with a star}

### Bullet Section 1: {Theme}
- {bullet}
- {bullet}
- {bullet}

### Bullet Section 2: {Theme}
- {bullet}
- {bullet}
- {bullet}

### Bullet Section 3-N: ...

---

### Usage Notes
- **Best for headline conversion:** {bullet #}
- **Best for email subject line:** {bullet #}
- **Best for ad hook:** {bullet #}
- **Ordering recommendation:** {advice for placement}
```

---

## Veto Conditions

- NEVER write a bullet that reveals the answer — the curiosity gap is the selling mechanism
- NEVER use vague language ("amazing results," "powerful secrets") — specificity is mandatory
- NEVER repeat the same formula more than twice in a set
- NEVER write bullets shorter than 8 words — they lack enough intrigue
- NEVER include bullets that promise something the product does not deliver

---

## Completion Criteria

- [ ] Source content mined for all possible bullet material
- [ ] Requested number of bullets written using varied formulas
- [ ] Each bullet creates a genuine curiosity gap
- [ ] Bullets scored and ordered strategically
- [ ] 3-5 killer bullets identified for multi-use
- [ ] Themed sections organized if applicable
- [ ] Usage notes provided for cross-context application
