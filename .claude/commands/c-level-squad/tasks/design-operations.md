---
task: designOperations()
responsavel: "@coo-orchestrator"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: company
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: team_structure
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: operational_design
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Core processes identified and mapped"
  - "[ ] Top 3 bottlenecks identified with quantified impact"
  - "[ ] OKR framework drafted for current quarter"
---

# Task: Design Operations

**Task ID:** CLEVEL-002
**Version:** 1.0.0
**Command:** `*design-operations`
**Agent:** COO Orchestrator (coo-orchestrator)
**Purpose:** Design operational excellence through process mapping, bottleneck elimination, OKR frameworks, and execution cadence

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `company` | User prompt | Yes | Company name and current operational context |
| `strategic_pillars` | vision-chief | No | Strategic pillars from set-vision task |
| `team_structure` | User | Yes | Current team size, roles, departments |
| `pain_points` | User | No | Known operational challenges and bottlenecks |
| `tools` | User | No | Current operational tools (PM, CRM, comms, etc.) |

## Preconditions

- Company has at least a basic team structure
- Strategic direction exists (even if informal)
- Executive frameworks loaded (`data/executive-frameworks.yaml`)

## Execution Phases

### Phase 1: Map Processes

1. Identify the **5-7 core business processes** (value-creating activities):
   - Sales/revenue generation
   - Product/service delivery
   - Customer support/success
   - Hiring and onboarding
   - Financial operations
   - Marketing and growth
2. For each process, map:
   - **Steps:** Sequential activities from trigger to outcome
   - **Owners:** Who is responsible for each step
   - **Handoffs:** Where work transfers between people/teams
   - **Tools:** Systems used at each step
   - **SLAs:** Expected time for each step
3. Identify **process maturity** for each:
   - Ad-hoc (no defined process)
   - Defined (documented but inconsistent)
   - Managed (measured and monitored)
   - Optimized (continuously improved)
4. Document the current state process map

### Phase 2: Identify Bottlenecks

1. For each core process, identify:
   - **Bottlenecks:** Where work piles up or slows down
   - **Single points of failure:** Steps that depend on one person
   - **Waste:** Steps that add time but not value (Lean thinking)
   - **Rework loops:** Where errors cause repeated effort
2. Quantify impact of each bottleneck:
   - Time cost (hours/week lost)
   - Revenue impact (deals delayed, customers waiting)
   - Team morale impact (frustration, burnout risk)
3. Prioritize bottlenecks using **Impact vs Effort** matrix:
   - Quick wins (high impact, low effort): Do first
   - Strategic projects (high impact, high effort): Plan carefully
   - Fill-ins (low impact, low effort): Delegate
   - Time sinks (low impact, high effort): Eliminate
4. Select **top 3 bottlenecks** for immediate action
5. Design solutions for each (automation, hire, process redesign, tool change)

### Phase 3: Design OKRs

1. Create the **OKR Architecture** aligned with strategic pillars:
   - **Company OKRs:** 3-5 objectives for the quarter
   - **Team OKRs:** 2-3 objectives per team, aligned upward
   - **Individual OKRs:** 2-3 per person (optional at early stage)
2. For each objective:
   - Write as **aspirational outcome** (not a task)
   - Define **2-3 Key Results** that are measurable and time-bound
   - Set **confidence level** at start (typically 50% for stretch goals)
   - Assign **owner** (one person, even for team OKRs)
3. Apply OKR best practices:
   - 60% top-down, 40% bottom-up
   - Score 0.0-1.0 (0.7 is success for stretch goals)
   - Separate committed OKRs (must hit) from aspirational (stretch)
   - OKRs are NOT linked to compensation
4. Create the **OKR tracking template**

### Phase 4: Implement Cadence

1. Design the **Operating Cadence** (meeting rhythm):
   - **Daily:** 15-min standup (what I did, what I'll do, blockers)
   - **Weekly:** 60-min team sync (metrics review, priorities, decisions)
   - **Monthly:** 90-min business review (OKR progress, financial health)
   - **Quarterly:** Half-day strategy session (OKR scoring, next quarter planning)
   - **Annual:** Full-day offsite (vision review, annual planning)
2. For each cadence meeting, define:
   - **Agenda template** (standard format)
   - **Attendees** (who must be there)
   - **Decisions expected** (what gets resolved)
   - **Artifacts** (what gets produced/updated)
3. Design the **Escalation Protocol**:
   - Level 1: Team lead resolves within 24h
   - Level 2: Department head resolves within 48h
   - Level 3: C-level resolves within 72h
   - Level 4: CEO immediate (customer-facing crisis, legal, security)
4. Create the **Operational Dashboard** with:
   - OKR progress (red/yellow/green)
   - Process health metrics
   - Team capacity and utilization
   - Key financial indicators
5. Define the **continuous improvement loop** -- how operations evolve quarterly

## Output Format

```yaml
operational_design:
  company: "{name}"
  core_processes: {count: 0, mapped: 0, maturity_avg: ""}
  bottlenecks:
    identified: {number}
    top_3: ["{bottleneck1}", "{bottleneck2}", "{bottleneck3}"]
    estimated_time_saved: "{hours/week}"
  okr_framework:
    company_objectives: {number}
    team_objectives: {number}
    quarter: "{Q1/Q2/Q3/Q4 YYYY}"
  cadence:
    daily: "15-min standup"
    weekly: "60-min team sync"
    monthly: "90-min business review"
    quarterly: "Half-day strategy"
  deliverables:
    - process-map.md
    - bottleneck-analysis.md
    - okr-framework.md
    - operating-cadence.md
    - operational-dashboard.md
```

## Veto Conditions

1. **NEVER design OKRs without understanding current processes** -- OKRs measure outcomes, not fix broken processes
2. **NEVER implement all cadence meetings at once in a small team** -- start with weekly and monthly, add as needed
3. **NEVER link OKRs to compensation** -- this destroys the stretch goal culture
4. **NEVER ignore team capacity when setting OKRs** -- stretch goals should not mean burnout
5. **NEVER map processes without talking to the people doing the work** -- ivory tower process design fails

## Completion Criteria

- [ ] 5-7 core processes identified and mapped
- [ ] Process maturity assessed for each
- [ ] Top 3 bottlenecks identified with quantified impact
- [ ] Solutions designed for priority bottlenecks
- [ ] Company and team OKRs drafted for current quarter
- [ ] Operating cadence designed with agenda templates
- [ ] Escalation protocol defined (4 levels)
- [ ] Operational dashboard designed
- [ ] Output matches schema above
