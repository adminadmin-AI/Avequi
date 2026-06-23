---
task: generateHandoff()
responsavel: "@ui-engineer"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: design_files
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: tech_stack
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: handoffDocumentation
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] All components inventoried and mapped to design system"
  - "[ ] Every visual value mapped to a design token"
  - "[ ] Dev review completed with tradeoffs documented"
---

# Task: Developer Handoff Documentation

**Task ID:** DESIGN-006
**Version:** 1.0.0
**Command:** `*generate-handoff`
**Agent:** UI Engineer (ui-engineer) + Dan Mall (dan-mall)
**Purpose:** Generate comprehensive developer handoff documentation for design-to-code translation.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `design_files` | Figma/Sketch files or screenshots | YES |
| `design_system` | Existing design system reference | PREFERRED |
| `tech_stack` | Frontend framework and CSS approach | YES |
| `component_list` | Components used in the design | PREFERRED |
| `interaction_specs` | Animations, transitions, hover states | PREFERRED |
| `responsive_requirements` | Breakpoints and adaptation behavior | NO |

## Preconditions

1. Designs are finalized and approved
2. Design system exists (or token values are specified)
3. Tech stack is known for code-specific guidance
4. Interactive behaviors are documented or demonstrable

## Execution Phases

### Phase 1: Inventory Components

1. Map every unique component used in the designs
2. For each component, determine:
   - Does it exist in the design system already? (Reference existing)
   - Is it a variant of an existing component? (Document the variant)
   - Is it entirely new? (Flag for design system addition)
3. Create a component dependency tree — which components compose others?
4. Identify shared patterns — reusable layouts, spacing patterns, interaction patterns
5. List all icons, illustrations, and media assets needed
6. Document third-party components or libraries required

### Phase 2: Specify Tokens

1. **Color Mapping** — Map every color in the design to a design token
   - If no token exists, propose a new semantic token
   - Document both light and dark mode values
   - Verify contrast ratios (AA compliance: 4.5:1 text, 3:1 UI)
2. **Typography Mapping** — Map all text styles to typography tokens
   - Font family, size, weight, line height, letter spacing
   - Responsive type scale adjustments
3. **Spacing Mapping** — Map all padding, margins, and gaps to spacing tokens
   - Component internal spacing
   - Between-component spacing
   - Section and page-level spacing
4. **Border and Shadow Mapping** — Map decorative styles to tokens
5. **Motion Mapping** — Map animations to motion tokens (duration, easing, properties)
6. Export a complete token-to-design mapping table

### Phase 3: Document Interactions

1. **State Transitions** — For each interactive element:
   - Default → Hover: What changes? (color, shadow, scale, cursor)
   - Default → Focus: What changes? (outline, ring, background)
   - Default → Active: What changes? (transform, color)
   - Default → Disabled: What changes? (opacity, cursor, pointer-events)
2. **Micro-interactions** — Animations triggered by user actions:
   - Button press feedback
   - Form validation appearance
   - Toast/notification entry and exit
   - Loading indicators and skeleton screens
   - Page transitions
3. **Gesture Support** — Mobile-specific interactions:
   - Swipe actions
   - Pull to refresh
   - Long press
   - Pinch to zoom
4. **Keyboard Navigation** — Tab order, shortcut keys, focus management
5. **Conditional Logic** — Show/hide rules, validation rules, progressive disclosure

### Phase 4: Review with Dev

1. Walk through the handoff with the development team
2. Clarify ambiguities — address every "what happens when...?" question
3. Identify technical constraints — what is hard or impossible to implement?
4. Negotiate tradeoffs — where can design flex for technical feasibility?
5. Agree on implementation priority — which components/screens first?
6. Establish the QA process — how will design verify the implementation?
7. Document all decisions and tradeoffs from the review

## Output Format

```yaml
handoff:
  creators: [ui-engineer, dan-mall]
  tech_stack: "{framework}"
  design_system: "{system name}"
  components:
    existing: ["{components from design system}"]
    variants_needed: ["{new variants of existing}"]
    new_required: ["{entirely new components}"]
  token_map:
    colors:
      - design_value: "{hex or rgba}"
        token: "{token name}"
        usage: "{where used}"
    typography:
      - design_style: "{style name}"
        token: "{token name}"
    spacing:
      - design_value: "{px value}"
        token: "{token name}"
  interactions:
    state_transitions:
      - element: "{component}"
        states: "{default → hover → focus → active → disabled}"
        animation: "{duration, easing}"
    micro_interactions:
      - trigger: "{user action}"
        animation: "{description}"
        duration: "{ms}"
        easing: "{function}"
    keyboard:
      tab_order: ["{element sequence}"]
      shortcuts: ["{key: action}"]
  responsive:
    breakpoints: ["{px values}"]
    adaptations:
      - breakpoint: "{px}"
        changes: ["{layout changes}"]
  assets:
    icons: ["{icon list with format}"]
    images: ["{image list with sizes}"]
    fonts: ["{font files}"]
  dev_review_notes: ["{decisions and tradeoffs}"]
  qa_checklist: ["{verification items}"]
```

## Veto Conditions

- **NEVER** hand off designs without token mapping — developers should never guess at values
- **NEVER** skip interaction documentation — static mockups are incomplete specifications
- **NEVER** omit responsive behavior — if it is not specified, it will be implemented inconsistently
- **NEVER** skip the dev review — one conversation prevents days of rework
- **NEVER** hand off without accessibility specifications — they must be part of the spec, not an afterthought

## Completion Criteria

- [ ] All components inventoried and mapped to design system
- [ ] Every visual value mapped to a design token
- [ ] State transitions documented for all interactive elements
- [ ] Micro-interactions specified with timing and easing
- [ ] Keyboard navigation and accessibility documented
- [ ] Responsive behavior specified for all breakpoints
- [ ] Assets exported in required formats
- [ ] Dev review completed with tradeoffs documented
- [ ] QA checklist created for implementation verification
