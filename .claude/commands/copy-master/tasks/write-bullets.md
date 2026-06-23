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
  - "[ ] Psychological Layer applied (Cialdini/Warren principles tagged)"
---

# Task: Write Bullet Points

**Task ID:** COPY-M-010
**Version:** 2.0.0
**Command:** `*write-bullets`
**Agent:** Gary Bencivenga (gary-bencivenga)
**Purpose:** Write curiosity-driven bullet points (fascinations) that sell without revealing the answer, powered by persuasion psychology.

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

## Champion Reference

Study these real-world champion bullet examples before writing:

1. **Boardroom / Bottom Line Personal bullets** (Mel Martin, Jim Rutz) — "What never to eat on an airplane" style fascinations that sold millions of newsletter subscriptions
2. **Gary Bencivenga's "Bencivenga Bullets"** newsletter — The master's own fascination-style naming convention, pure curiosity gap execution
3. **Agora Financial "Hidden" bullets** — "The $2 bill trick that forces your bank to..." style, specific numbers + forbidden knowledge framing
4. **John Carlton's "One-Legged Golfer" bullets** — Proof-based fascinations with extreme specificity that disarm skepticism
5. **Clayton Makepeace health supplement bullets** — Fear + curiosity combination: "The common household item that may be silently destroying your..."

---

## Execution Phases

### Phase 1: Source Mining
1. Extract every unique claim, feature, benefit, or fact from the source content
2. Identify which facts are most surprising, counterintuitive, or valuable
3. Rank by "would someone pay money just to know this?" factor
4. Group by theme for organized bullet sections
5. Target at least 2x the requested bullet count as raw material

### Phase 2: Psychological Layer
1. Tag each bullet with its primary Cialdini principle:
   - **Authority bullets:** "What Harvard researchers discovered about..."
   - **Social Proof bullets:** "The method used by 93% of top performers..."
   - **Scarcity bullets:** "The disappearing loophole that lets you..."
   - **Reciprocity bullets:** Reveal a small insight that makes them want the full answer
   - **Unity bullets:** "What every [identity group] needs to know about..."
2. Apply Blair Warren's levers to bullet construction:
   - Encourage dreams: "How to {dream outcome} in {timeframe}"
   - Justify failures: "Why {common approach} never worked — and what to do instead"
   - Confirm suspicions: "The truth about {thing they suspect} — you were right all along"
   - Throw rocks at enemies: "What {authority/industry} doesn't want you to know"
3. Ensure variety — no more than 3 consecutive bullets use the same psychological driver

### Phase 3: Bullet Writing
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

### Phase 4: Selection and Ordering
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

### Persuasion Distribution
| Cialdini Principle | Count | Warren Lever | Count |
|-------------------|-------|-------------|-------|

---

### Top Bullets (Killer Headlines)
{3-5 strongest bullets marked with a star}

### Bullet Section 1: {Theme}
- {bullet} — [{Cialdini principle}]
- {bullet} — [{Cialdini principle}]
- {bullet} — [{Cialdini principle}]

### Bullet Section 2: {Theme}
- {bullet} — [{Cialdini principle}]
- {bullet} — [{Cialdini principle}]
- {bullet} — [{Cialdini principle}]

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
- [ ] Psychological Layer applied — Cialdini principles tagged per bullet
- [ ] Blair Warren levers varied across the bullet set
