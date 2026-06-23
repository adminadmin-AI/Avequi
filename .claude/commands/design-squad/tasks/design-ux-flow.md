---
task: designUxFlow()
responsavel: "@ux-designer"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: feature_or_product
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: target_users
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: uxFlow
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] User research conducted with documented insights"
  - "[ ] 2-3 personas created with goals and pain points"
  - "[ ] Wireframes created for all key screens and flows"
---

# Task: UX Research & Flow Design

**Task ID:** DESIGN-005
**Version:** 1.0.0
**Command:** `*design-ux-flow`
**Agent:** UX Designer (ux-designer)
**Purpose:** Conduct user research and design user experience flows from personas through wireframes.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `feature_or_product` | What is being designed | YES |
| `target_users` | Who will use this | YES |
| `business_goals` | What the business wants to achieve | YES |
| `existing_research` | Prior user research, analytics | NO |
| `constraints` | Technical, time, budget limitations | NO |
| `competitive_context` | How competitors solve this | NO |

## Preconditions

1. Feature or product scope is defined
2. Target user group is at least loosely identified
3. Business goals are articulated

## Execution Phases

### Phase 1: User Research

1. **Define research questions** — What do we need to learn to design well?
2. **Identify research methods** based on project needs:
   - User interviews (qualitative — understanding motivations and pain)
   - Surveys (quantitative — validating hypotheses at scale)
   - Contextual inquiry (observe users in their natural environment)
   - Card sorting (understand mental models for information architecture)
   - Competitive analysis (how do others solve this problem?)
   - Analytics review (what does existing data tell us?)
3. **Conduct research** — Execute selected methods
4. **Synthesize findings** — Identify patterns, themes, and insights
5. **Create insight statements** — "Users need [X] because [Y], but currently [Z]"
6. Document all findings in a research repository

### Phase 2: Persona & Journey Mapping

1. **Create user personas** (2-3 primary personas):
   - Demographics, role, and context
   - Goals and motivations
   - Pain points and frustrations
   - Behaviors and habits
   - Quote that captures their essence
   - Technical proficiency level
2. **Map current journey** (As-Is):
   - Stages the user goes through today
   - Actions at each stage
   - Thoughts and feelings at each stage
   - Pain points and opportunities
   - Touchpoints (where they interact with the product/service)
3. **Map desired journey** (To-Be):
   - Improved stages with pain points resolved
   - New touchpoints and interactions
   - Emotional uplift at key moments
   - Moments of delight

### Phase 3: Information Architecture

1. **Content inventory** — What content/features must be organized?
2. **Card sorting results** — How do users naturally group information?
3. **Site map / App map** — Hierarchical structure of pages/screens
4. **Navigation model** — Primary, secondary, contextual navigation
5. **Naming conventions** — Labels that match user mental models (not internal jargon)
6. **Search and filtering** — How users find content within the structure
7. Validate IA with tree testing (can users find what they need?)

### Phase 4: Wireframes

1. **Low-fidelity sketches** — Rapid exploration of layout options (3-5 alternatives per key screen)
2. **Mid-fidelity wireframes** — Selected approach refined with:
   - Layout grid and spacing
   - Component placement and hierarchy
   - Content priority (what is most important on each screen)
   - Interaction patterns (how users move between states)
   - Error states and empty states
   - Loading states
3. **User flows** — Step-by-step paths for key tasks:
   - Happy path (everything goes right)
   - Error path (what happens when things go wrong)
   - Edge cases (unusual but valid scenarios)
4. **Annotation** — Document interaction behaviors, validation rules, conditional logic
5. **Responsive considerations** — How wireframes adapt across breakpoints

### Phase 5: Validation & Testing

1. **Usability testing** — Test wireframes with 5+ representative users
2. **Task success rate** — Can users complete key tasks?
3. **Time on task** — How long does each task take?
4. **Error rate** — Where do users make mistakes?
5. **Satisfaction** — How do users feel about the experience?
6. Document findings and iterate on wireframes
7. Handoff validated wireframes to visual design and development

## Output Format

```yaml
ux_flow:
  designer: "ux-designer"
  feature: "{feature/product name}"
  research:
    methods_used: ["{methods}"]
    key_insights: ["{insight statements}"]
    participants: 0
  personas:
    - name: "{persona name}"
      role: "{role}"
      goals: ["{goals}"]
      pain_points: ["{pains}"]
      quote: "{representative quote}"
  journey_map:
    stages: ["{stage list}"]
    pain_points: ["{key pains}"]
    opportunities: ["{design opportunities}"]
  information_architecture:
    site_map: "{structure description}"
    navigation_model: "{nav pattern}"
    key_labels: ["{naming}"]
  wireframes:
    screens: ["{screen list}"]
    user_flows: ["{flow list}"]
    interaction_notes: ["{key behaviors}"]
  validation:
    method: "{testing method}"
    task_success_rate: "{percentage}"
    key_findings: ["{what we learned}"]
    iterations: ["{changes made}"]
```

## Veto Conditions

- **NEVER** skip user research and jump straight to wireframes — assumptions lead to wasted design
- **NEVER** design for a single persona — consider the range of users
- **NEVER** use internal jargon in navigation or labels — use the user's language
- **NEVER** design only the happy path — error states and edge cases are part of the experience
- **NEVER** skip usability testing — untested designs are assumptions, not solutions

## Completion Criteria

- [ ] User research conducted with documented insights
- [ ] 2-3 personas created with goals and pain points
- [ ] Journey map created showing current and desired states
- [ ] Information architecture defined and validated
- [ ] Wireframes created for all key screens and flows
- [ ] Error states, empty states, and loading states designed
- [ ] Usability testing completed with findings documented
- [ ] Wireframes iterated based on test results
