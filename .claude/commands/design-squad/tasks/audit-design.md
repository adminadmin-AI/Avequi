---
task: auditDesign()
responsavel: "@dave-malouf"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: organization_context
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: current_design_practice
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: designAudit
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] All three lenses assessed with scores and specific findings"
  - "[ ] Top 3-5 highest-leverage improvements identified"
  - "[ ] Phased roadmap created with milestones"
---

# Task: Design Audit & Maturity Assessment

**Task ID:** DESIGN-002
**Version:** 1.0.0
**Command:** `*audit-design`
**Agent:** Dave Malouf (dave-malouf) + Design Chief (design-chief)
**Purpose:** Assess design maturity across three lenses and identify gaps with an improvement roadmap.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `organization_context` | Company size, stage, industry | YES |
| `current_design_practice` | Team, tools, processes | YES |
| `design_artifacts` | Existing designs, systems, docs | PREFERRED |
| `stakeholder_concerns` | Pain points from leadership | NO |
| `product_portfolio` | Products/services using design | NO |

## Preconditions

1. Access to current design practice information
2. Understanding of organizational structure and design team placement
3. Willingness to assess honestly (not just validate current approach)

## Execution Phases

### Phase 1: Assess Maturity (3 Lenses)

**Lens 1: How We Work Together (People & Culture)**
1. Team structure — centralized, embedded, hybrid?
2. Role clarity — are design roles well-defined?
3. Career paths — do designers have growth trajectories?
4. Hiring practices — how is design talent evaluated?
5. Cross-functional collaboration — how do design, engineering, and product interact?
6. Design culture — is design valued at the leadership level?
7. Rate: Ad Hoc (1) → Emerging (2) → Defined (3) → Managed (4) → Optimized (5)

**Lens 2: How We Work (Process & Workflow)**
1. Design process — is there a consistent methodology?
2. Research practice — how are user insights gathered and used?
3. Handoff process — how do designs get to engineers?
4. Quality assurance — how is design quality verified?
5. Feedback loops — how do teams learn from shipped products?
6. Tooling — is the tool stack consistent and efficient?
7. Rate: Ad Hoc (1) → Emerging (2) → Defined (3) → Managed (4) → Optimized (5)

**Lens 3: What We Work On (Craft & Output)**
1. Design system — does one exist? Is it used consistently?
2. Accessibility — is WCAG compliance standard practice?
3. Visual consistency — are products visually coherent?
4. UX quality — are products usable and intuitive?
5. Innovation — is the team pushing design boundaries?
6. Documentation — are design decisions recorded and shared?
7. Rate: Ad Hoc (1) → Emerging (2) → Defined (3) → Managed (4) → Optimized (5)

### Phase 2: Identify Gaps

1. Map current maturity scores across all three lenses
2. Identify the lowest-scoring lens — this is the primary bottleneck
3. Within each lens, identify specific gaps:
   - What exists but is broken or inconsistent?
   - What is entirely missing?
   - What is working well and should be preserved?
4. Cross-reference gaps — do people gaps cause process gaps cause craft gaps?
5. Benchmark against industry standards for the company's stage and size
6. Identify the 3-5 highest-leverage improvements

### Phase 3: Recommend Improvements

1. For each identified gap, recommend a specific intervention:
   - **Quick wins** (1-2 weeks) — Low effort, immediate impact
   - **Short-term** (1-3 months) — Moderate effort, significant improvement
   - **Long-term** (3-12 months) — Strategic investment for lasting change
2. Prioritize by impact and feasibility
3. Identify dependencies — what must happen first?
4. Estimate resource requirements — people, tools, budget
5. Define success metrics for each improvement

### Phase 4: Build Roadmap

1. Create a phased improvement roadmap:
   - **Phase 1 (Month 1-2):** Foundation — Quick wins + critical fixes
   - **Phase 2 (Month 3-6):** Building — Process standardization + tooling
   - **Phase 3 (Month 6-12):** Scaling — Culture change + advanced practices
2. Define milestones and checkpoints
3. Assign ownership for each initiative
4. Create a measurement plan — how will progress be tracked?
5. Plan for communication — how will the organization be informed and engaged?
6. Define the governance model for ongoing design maturity improvement

## Output Format

```yaml
design_audit:
  auditors: [dave-malouf, design-chief]
  organization: "{company}"
  maturity_scores:
    people_culture:
      score: 0
      level: "Ad Hoc | Emerging | Defined | Managed | Optimized"
      strengths: ["{what works}"]
      gaps: ["{what is missing}"]
    process_workflow:
      score: 0
      level: "Ad Hoc | Emerging | Defined | Managed | Optimized"
      strengths: ["{what works}"]
      gaps: ["{what is missing}"]
    craft_output:
      score: 0
      level: "Ad Hoc | Emerging | Defined | Managed | Optimized"
      strengths: ["{what works}"]
      gaps: ["{what is missing}"]
  overall_maturity: 0
  primary_bottleneck: "{lowest scoring lens}"
  top_improvements:
    - improvement: "{description}"
      impact: "HIGH | MEDIUM | LOW"
      effort: "HIGH | MEDIUM | LOW"
      timeline: "quick_win | short_term | long_term"
  roadmap:
    phase_1: ["{foundation items}"]
    phase_2: ["{building items}"]
    phase_3: ["{scaling items}"]
  measurement_plan: ["{metrics to track}"]
```

## Veto Conditions

- **NEVER** assess maturity without considering all three lenses — they are interconnected
- **NEVER** recommend advanced practices for an organization at Ad Hoc maturity — meet them where they are
- **NEVER** ignore people and culture — process and tools fail without the right culture
- **NEVER** create a roadmap without clear ownership and milestones
- **NEVER** skip the strengths assessment — build on what works, do not only focus on gaps

## Completion Criteria

- [ ] All three lenses assessed with scores and specific findings
- [ ] Gaps identified and cross-referenced across lenses
- [ ] Top 3-5 highest-leverage improvements identified
- [ ] Improvements prioritized by impact and feasibility
- [ ] Phased roadmap created with milestones
- [ ] Measurement plan defined for tracking progress
- [ ] Ownership assigned for each initiative
