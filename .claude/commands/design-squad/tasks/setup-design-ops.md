---
task: setupDesignOps()
responsavel: "@dave-malouf"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: team_context
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: current_pain_points
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: designOpsPractice
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Current state assessed with bottlenecks identified"
  - "[ ] Design workflow defined with stages, activities, and gates"
  - "[ ] Metrics defined for ongoing health tracking"
---

# Task: DesignOps Practice Setup

**Task ID:** DESIGN-003
**Version:** 1.0.0
**Command:** `*setup-design-ops`
**Agent:** Dave Malouf (dave-malouf)
**Purpose:** Establish a DesignOps practice to scale design quality and team effectiveness.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `team_context` | Design team size, structure, maturity | YES |
| `current_pain_points` | Biggest operational challenges | YES |
| `tools_in_use` | Current design and collaboration tools | PREFERRED |
| `engineering_workflow` | How dev team works (agile, kanban, etc.) | PREFERRED |
| `budget_constraints` | Available budget for tools/hires | NO |

## Preconditions

1. Design team exists (even if small)
2. Pain points are identified and acknowledged
3. Leadership buy-in for improving design operations

## Execution Phases

### Phase 1: Assess Current State

1. Map the current design workflow from brief to shipped product
2. Identify bottlenecks — where does work get stuck or delayed?
3. Assess tool landscape — are tools consistent? Redundant? Missing?
4. Evaluate handoff quality — how well do designs translate to code?
5. Review meeting and ceremony structure — are design reviews happening?
6. Assess design documentation practices — is institutional knowledge captured?
7. Interview/survey the team — what do they need most?

### Phase 2: Design Workflow

1. Define the design workflow stages:
   - **Discover** — Research, user insights, problem framing
   - **Define** — Requirements, constraints, success criteria
   - **Design** — Exploration, iteration, refinement
   - **Deliver** — Handoff, QA, implementation support
   - **Measure** — Post-launch analysis, iteration planning
2. For each stage, define:
   - Inputs required (what must exist before starting)
   - Activities (what happens during this stage)
   - Outputs produced (what must exist before moving forward)
   - Review gates (who reviews and what criteria)
3. Map the workflow to the engineering process — where do they intersect?
4. Define design sprint cadence — how long is a design cycle?
5. Establish critique and review rituals:
   - Design critique (weekly, peers)
   - Design review (per milestone, stakeholders)
   - Design QA (pre-ship, designer + engineer)

### Phase 3: Define People Ops

1. **Role Definitions** — Clear expectations for each design role
   - UX Designer, UI Designer, Design System Engineer, UX Researcher, Design Lead
2. **Career Framework** — Growth paths for designers
   - IC track: Junior → Mid → Senior → Staff → Principal
   - Management track: Lead → Manager → Director → VP
3. **Skill Matrix** — Competencies expected at each level
4. **Onboarding** — How new designers get up to speed
   - Tool setup guide
   - Design system introduction
   - Team norms and rituals
   - First-week, first-month milestones
5. **Knowledge Management** — How design decisions and rationale are documented
   - Decision records for major design choices
   - Pattern documentation for reusable solutions
   - Research repository for user insights

### Phase 4: Implement Tools & Infrastructure

1. **Design Tools** — Standardize on a primary design tool (Figma recommended)
   - File organization and naming conventions
   - Library structure for shared components
   - Version control practices
2. **Collaboration Tools** — How design shares work with engineering and product
   - Design specs and handoff tool
   - Component documentation platform
   - Feedback and annotation tools
3. **Research Tools** — User testing, analytics, feedback collection
4. **Asset Management** — Icon library, illustration system, brand assets
5. **Metrics Dashboard** — Track design ops health:
   - Cycle time (brief to shipped)
   - Rework rate (how often designs change after handoff)
   - Design system adoption rate
   - Team satisfaction scores
   - Accessibility compliance rate

## Output Format

```yaml
design_ops:
  architect: "dave-malouf"
  team_size: 0
  maturity_level: "Ad Hoc | Emerging | Defined | Managed | Optimized"
  workflow:
    stages: [discover, define, design, deliver, measure]
    sprint_cadence: "{duration}"
    rituals:
      - name: "{ritual}"
        frequency: "{cadence}"
        participants: ["{roles}"]
  people_ops:
    roles_defined: ["{role list}"]
    career_framework: true
    onboarding_plan: true
    knowledge_management: "{approach}"
  tools:
    design: "{primary tool}"
    collaboration: "{tool}"
    research: "{tool}"
    asset_management: "{tool}"
  metrics:
    cycle_time: "{target}"
    rework_rate: "{target}"
    system_adoption: "{target}"
    team_satisfaction: "{target}"
  implementation_plan:
    week_1_2: ["{immediate setup}"]
    month_1: ["{foundation}"]
    month_3: ["{optimization}"]
```

## Veto Conditions

- **NEVER** introduce tools without defining the workflow first — tools serve process, not the reverse
- **NEVER** skip people ops — design ops fails without clear roles and career paths
- **NEVER** copy another company's design ops wholesale — adapt to your team's maturity
- **NEVER** implement everything at once — phase it or the team will be overwhelmed
- **NEVER** build design ops in isolation from engineering — it must integrate

## Completion Criteria

- [ ] Current state assessed with bottlenecks identified
- [ ] Design workflow defined with stages, activities, and gates
- [ ] Workflow mapped to engineering process
- [ ] Critique and review rituals established
- [ ] Role definitions and career framework created
- [ ] Onboarding plan documented
- [ ] Tool stack standardized with conventions
- [ ] Metrics defined for ongoing health tracking
