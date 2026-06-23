---
task: createDesignSystem()
responsavel: "@brad-frost"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: project_context
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: tech_stack
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: designSystem
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Interface audit completed with inconsistencies documented"
  - "[ ] All design tokens defined (colors, typography, spacing, borders, shadows)"
  - "[ ] Documentation complete with examples and contribution guide"
---

# Task: Atomic Design System Creation

**Task ID:** DESIGN-001
**Version:** 1.0.0
**Command:** `*create-design-system`
**Agent:** Brad Frost (brad-frost) + Dan Mall (dan-mall)
**Purpose:** Build a complete atomic design system from audit through atoms, molecules, organisms, and documentation.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `project_context` | Application or product description | YES |
| `brand_guidelines` | Colors, typography, logos | PREFERRED |
| `existing_ui` | Current interface screenshots or code | PREFERRED |
| `tech_stack` | Frontend framework and tools | YES |
| `team_size` | Design and dev team size | NO |
| `accessibility_requirements` | WCAG level target | NO (default: AA) |

## Preconditions

1. Project context and tech stack are defined
2. Brand guidelines exist (even minimal — colors and fonts at minimum)
3. Understanding of who will consume the design system (designers, developers, both)

## Execution Phases

### Phase 1: Audit Existing (brad-frost)

1. Conduct interface inventory — screenshot every unique component
2. Categorize existing UI elements by type:
   - Colors, typography, spacing, icons, borders, shadows
   - Buttons, inputs, labels, badges, links
   - Cards, forms, navigation, modals, tables
   - Page layouts, templates, responsive patterns
3. Identify inconsistencies — how many variations of the same component exist?
4. Assess current accessibility — WCAG compliance of existing elements
5. Document the "component zoo" — everything that exists today
6. Identify the 20% of components that cover 80% of the interface

### Phase 2: Define Atoms (brad-frost)

1. **Color tokens** — Define global palette, semantic colors, and component-level aliases
   - Global: brand colors, neutrals, feedback colors (success, warning, error, info)
   - Semantic: text-primary, text-secondary, bg-surface, bg-canvas, border-default
   - Component: button-primary-bg, input-border, card-shadow
2. **Typography tokens** — Font families, sizes, weights, line heights, letter spacing
   - Scale: xs, sm, base, lg, xl, 2xl, 3xl, 4xl
   - Semantic: heading-1 through heading-6, body, caption, label, code
3. **Spacing tokens** — Consistent spacing scale (4px base unit recommended)
   - Scale: 0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24
4. **Border tokens** — Radius scale, border widths, styles
5. **Shadow tokens** — Elevation levels (sm, md, lg, xl)
6. **Animation tokens** — Duration, easing, transition properties
7. **Breakpoint tokens** — Responsive breakpoints
8. Document each atom with usage guidelines

### Phase 3: Build Molecules & Organisms (brad-frost + dan-mall)

**Molecules (simple component groups):**
1. Button group (button + icon + label)
2. Input field (label + input + helper text + error message)
3. Search bar (input + button + icon)
4. Media object (image + text block)
5. Navigation item (icon + label + badge)
6. Card header (avatar + title + subtitle + action)

**Organisms (complex component groups):**
1. Navigation bar (logo + nav items + search + user menu)
2. Form section (heading + description + multiple input fields + actions)
3. Data table (header + rows + pagination + filters)
4. Card (header + media + content + footer + actions)
5. Modal (overlay + header + content + footer actions)
6. Sidebar (logo + navigation + user info + footer)

For each component:
- Define variants (size, color, state)
- Specify interactive states (default, hover, focus, active, disabled, loading)
- Document props/API
- Write accessibility requirements (ARIA roles, keyboard nav, screen reader)
- Create responsive behavior specification

### Phase 4: Document (dan-mall)

1. **Getting Started** — Installation, setup, and first component usage
2. **Design Principles** — The "why" behind design decisions
3. **Token Reference** — Complete token catalog with visual examples
4. **Component Catalog** — Each component with:
   - Description and purpose
   - Live examples with all variants
   - Props/API documentation
   - Do's and Don'ts with visual examples
   - Accessibility notes
   - Code snippets (copy-paste ready)
5. **Pattern Library** — Common compositions and layouts
6. **Contribution Guide** — How to add/modify components
7. **Governance Model** — Who approves changes, versioning, deprecation process

## Output Format

```yaml
design_system:
  name: "{system name}"
  creators: [brad-frost, dan-mall]
  methodology: "Atomic Design"
  tech_stack: "{framework}"
  accessibility_target: "WCAG 2.1 AA"
  tokens:
    colors: "{token count}"
    typography: "{token count}"
    spacing: "{token count}"
    borders: "{token count}"
    shadows: "{token count}"
  components:
    atoms: ["{list}"]
    molecules: ["{list}"]
    organisms: ["{list}"]
    templates: ["{list}"]
  documentation:
    getting_started: true
    token_reference: true
    component_catalog: true
    pattern_library: true
    contribution_guide: true
    governance_model: true
  governance:
    versioning: "semver"
    approval_process: "{description}"
    deprecation_policy: "{description}"
```

## Veto Conditions

- **NEVER** skip the audit phase — building without understanding what exists creates duplication
- **NEVER** define components without accessibility from the start — retrofitting is 10x harder
- **NEVER** create tokens without a clear naming convention and hierarchy
- **NEVER** skip documentation — an undocumented design system will not be adopted
- **NEVER** build organisms before atoms and molecules are solid

## Completion Criteria

- [ ] Interface audit completed with inconsistencies documented
- [ ] All design tokens defined (colors, typography, spacing, borders, shadows)
- [ ] Atoms documented with usage guidelines
- [ ] Molecules and organisms built with variants and states
- [ ] Accessibility requirements defined for every component
- [ ] Documentation complete with examples and contribution guide
- [ ] Governance model established for ongoing maintenance
