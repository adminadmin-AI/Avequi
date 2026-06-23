---
task: evaluateTechnology()
responsavel: "@cto-architect"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: company
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: current_stack
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: technology_strategy
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Current stack inventoried across all layers"
  - "[ ] Technology Radar built with 4 rings"
  - "[ ] 12-month technology roadmap created"
---

# Task: Evaluate Technology

**Task ID:** CLEVEL-004
**Version:** 1.0.0
**Command:** `*evaluate-technology`
**Agent:** CTO Architect (cto-architect)
**Purpose:** Assess technology strategy including current stack evaluation, technology radar, architectural decision records, and build vs buy analysis

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `company` | User prompt | Yes | Company name and product description |
| `current_stack` | User | Yes | Current technology stack and infrastructure |
| `team` | User | Yes | Engineering team size, skills, and structure |
| `challenges` | User | No | Known technical challenges or debt |
| `strategic_pillars` | vision-chief | No | Strategic pillars that tech must support |

## Preconditions

- Technology exists or is being planned
- Engineering team or technical leadership exists
- Executive frameworks loaded (`data/executive-frameworks.yaml`)

## Execution Phases

### Phase 1: Assess Current Stack

1. Inventory the **current technology landscape**:
   - Frontend: Languages, frameworks, build tools
   - Backend: Languages, frameworks, APIs
   - Data: Databases, caches, message queues
   - Infrastructure: Cloud provider, CI/CD, monitoring
   - Third-party: SaaS tools, APIs, integrations
2. Assess each technology against 5 dimensions:
   - **Fitness:** Does it solve the problem well?
   - **Scalability:** Can it handle 10x growth?
   - **Maintainability:** Is it easy to update and debug?
   - **Talent availability:** Can we hire for this?
   - **Community health:** Is the ecosystem growing or dying?
3. Calculate **technical debt score** (1-10 per area):
   - Code debt: Legacy code, duplication, missing tests
   - Architecture debt: Monolith issues, coupling, missing patterns
   - Infrastructure debt: Manual processes, missing automation
   - Documentation debt: Missing or outdated documentation
4. Identify **critical risks** -- single points of failure, security gaps, compliance issues
5. Document findings in a technology assessment report

### Phase 2: Technology Radar

1. Build a **Technology Radar** with 4 rings:
   - **Adopt:** Proven, recommended for broad use
   - **Trial:** Worth pursuing, proven in limited context
   - **Assess:** Worth exploring, understand impact
   - **Hold:** Proceed with caution, do not start new work
2. Categorize technologies into 4 quadrants:
   - **Languages & Frameworks**
   - **Tools & Infrastructure**
   - **Platforms & Services**
   - **Techniques & Patterns**
3. Place current and candidate technologies on the radar
4. For each technology in Trial/Assess:
   - Why it's interesting
   - What problem it solves
   - Risk of adoption
   - Recommended evaluation approach
5. For each technology on Hold:
   - Why it's being held
   - Migration path (if actively used)
6. Update cadence: quarterly review

### Phase 3: Architectural Decision Records (ADR)

1. Create the **ADR template** for the organization:
   - Title: Short descriptive title
   - Status: Proposed / Accepted / Deprecated / Superseded
   - Context: What is the situation and problem?
   - Decision: What is the decision made?
   - Consequences: What are the positive and negative results?
   - Alternatives: What other options were considered?
2. Document **existing implicit decisions** as ADRs:
   - Why was the current framework chosen?
   - Why this cloud provider?
   - Why this database?
   - Why this architecture pattern?
3. For each pending technology decision, create a **Decision ADR**:
   - Apply the **Build-Buy-Partner Matrix**:
     - Build: Core differentiator, unique requirements, team capability
     - Buy: Commodity, well-served by market, faster time-to-market
     - Partner: Strategic value, ecosystem integration, shared risk
   - Score each option on: cost, time, risk, strategic value, maintenance burden
4. Establish the **ADR review process** -- who approves, when to revisit

### Phase 4: Technology Roadmap

1. Align technology roadmap with **strategic pillars**:
   - For each strategic pillar, identify technology enablers
   - For each technology enabler, define implementation timeline
2. Define the **Build vs Buy** recommendation for each major component
3. Create the **12-month technology roadmap**:
   - Quarter 1: Foundation (fix critical debt, establish patterns)
   - Quarter 2: Capability (build new capabilities aligned to strategy)
   - Quarter 3: Scale (prepare for growth, optimize performance)
   - Quarter 4: Innovation (explore new technologies, prototype)
4. Define **engineering investment allocation**:
   - Feature development: X%
   - Technical debt: Y%
   - Innovation/R&D: Z%
   - Recommended: 70/20/10 for growth stage
5. Set **technology KPIs**:
   - Deployment frequency
   - Lead time for changes
   - Mean time to recovery (MTTR)
   - Change failure rate
   - Developer satisfaction score

## Output Format

```yaml
technology_strategy:
  company: "{name}"
  current_stack:
    frontend: ["{tech1}", "{tech2}"]
    backend: ["{tech1}", "{tech2}"]
    data: ["{tech1}", "{tech2}"]
    infrastructure: ["{tech1}", "{tech2}"]
  tech_debt_score: "{1-10 average}"
  critical_risks: ["{risk1}", "{risk2}"]
  technology_radar:
    adopt: ["{tech1}", "{tech2}"]
    trial: ["{tech1}"]
    assess: ["{tech1}"]
    hold: ["{tech1}"]
  adrs:
    documented: {number}
    pending_decisions: {number}
  investment_allocation:
    features: "{%}"
    tech_debt: "{%}"
    innovation: "{%}"
  roadmap:
    q1: "{theme and priorities}"
    q2: "{theme and priorities}"
    q3: "{theme and priorities}"
    q4: "{theme and priorities}"
  deliverables:
    - technology-assessment.md
    - technology-radar.md
    - adr-log/
    - tech-roadmap.md
    - build-buy-analysis.md
```

## Veto Conditions

1. **NEVER adopt new technology without an ADR** -- undocumented decisions haunt future teams
2. **NEVER ignore technical debt allocation** -- 100% feature development creates compounding debt
3. **NEVER choose technology based on hype** -- fitness for purpose is the only valid criterion
4. **NEVER build what you can buy for commodity functions** -- engineering time is the scarcest resource
5. **NEVER skip talent availability assessment** -- the best technology is useless if you can't hire for it

## Completion Criteria

- [ ] Current stack inventoried across all layers
- [ ] Technical debt scored (1-10) per area
- [ ] Critical risks identified
- [ ] Technology Radar built with 4 rings and 4 quadrants
- [ ] At least 3 ADRs documented (existing decisions)
- [ ] Build vs Buy analysis for major components
- [ ] 12-month technology roadmap aligned to strategic pillars
- [ ] Engineering investment allocation defined
- [ ] Technology KPIs set (DORA metrics)
- [ ] Output matches schema above
