---
task: createComponentSpec()
responsavel: "@design-system-architect"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: component_name
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: tech_stack
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: componentSpec
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] All variants specified (size, intent, state, layout, content)"
  - "[ ] Design tokens mapped with fallback chain"
  - "[ ] Accessibility requirements complete (ARIA, keyboard, screen reader)"
---

# Task: Component Specification

**Task ID:** DESIGN-004
**Version:** 1.0.0
**Command:** `*create-component-spec`
**Agent:** Design System Architect (design-system-architect) + Brad Frost (brad-frost)
**Purpose:** Create a complete component specification with variants, tokens, accessibility, and API documentation.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `component_name` | User request | YES |
| `component_purpose` | What problem it solves | YES |
| `design_system_context` | Existing tokens and patterns | PREFERRED |
| `tech_stack` | Framework (React, Vue, Svelte, etc.) | YES |
| `usage_context` | Where it will be used | PREFERRED |
| `reference_examples` | Existing implementations to reference | NO |

## Preconditions

1. Component purpose is clearly defined
2. Design token system exists (or will be created alongside)
3. Tech stack is known for API design

## Execution Phases

### Phase 1: Define Purpose

1. State the component's purpose — what user need does it serve?
2. Identify where it sits in the atomic hierarchy: atom, molecule, or organism
3. List use cases — where will this component appear?
4. Define what this component is NOT (prevent scope creep)
5. Check existing components — can an existing component be extended instead?
6. Identify component dependencies — what atoms/molecules does it compose?

### Phase 2: Design Variants

1. **Size variants** — sm, md, lg (where applicable)
2. **Color/intent variants** — primary, secondary, danger, warning, success, neutral
3. **State variants:**
   - Default (resting state)
   - Hover (mouse over)
   - Focus (keyboard focus — visible focus ring)
   - Active (being clicked/pressed)
   - Disabled (non-interactive)
   - Loading (async operation in progress)
   - Error (validation failure)
   - Selected/Checked (toggle state)
4. **Layout variants** — inline, block, full-width, responsive behavior
5. **Content variants** — with/without icon, with/without description, truncation behavior
6. For each variant, define visual specifications: colors, spacing, typography, borders

### Phase 3: Specify Tokens

1. Map component styles to design tokens (never use raw values):
   - Background: `{component}-{variant}-bg`
   - Text: `{component}-{variant}-text`
   - Border: `{component}-{variant}-border`
   - Shadow: `{component}-{variant}-shadow`
   - Spacing: `{component}-padding-{size}`
   - Typography: `{component}-font-{property}`
2. Define token fallback chain: component token → alias token → global token
3. Ensure all color tokens support dark mode theming
4. Document which tokens are customizable vs locked
5. Verify contrast ratios meet WCAG AA (4.5:1 text, 3:1 UI elements)

### Phase 4: Document API

1. **Props/Attributes:**
   - Name, type, default value, description
   - Required vs optional
   - Valid values for enums
2. **Events/Callbacks:**
   - Event name, payload, when it fires
3. **Slots/Children:**
   - Named slots and their expected content
   - Default slot behavior
4. **Accessibility:**
   - ARIA role and attributes
   - Keyboard interaction pattern (Tab, Enter, Space, Arrow keys, Escape)
   - Screen reader announcement behavior
   - Focus management (where focus goes, trap behavior)
   - Color contrast verification
5. **Responsive Behavior:**
   - Breakpoint-specific adaptations
   - Touch target sizes (minimum 44x44px)
   - Mobile-specific interactions
6. **Code Examples:**
   - Basic usage
   - Each variant
   - Composition with other components
   - Common patterns

## Output Format

```yaml
component_spec:
  name: "{component name}"
  creators: [design-system-architect, brad-frost]
  atomic_level: "atom | molecule | organism"
  purpose: "{what it does}"
  dependencies: ["{required sub-components}"]
  variants:
    sizes: ["{size list}"]
    intents: ["{intent list}"]
    states: ["{state list}"]
  tokens:
    - token: "{token name}"
      value: "{default value}"
      customizable: true
      dark_mode: "{dark value}"
  props:
    - name: "{prop name}"
      type: "{type}"
      default: "{default}"
      required: true
      description: "{what it controls}"
  events:
    - name: "{event name}"
      payload: "{data type}"
      description: "{when it fires}"
  accessibility:
    role: "{ARIA role}"
    keyboard: ["{interaction pattern}"]
    announcements: ["{screen reader behavior}"]
    contrast: "verified AA"
  responsive:
    breakpoints: ["{adaptations}"]
    touch_target: "44x44px minimum"
  code_examples:
    basic: "{code}"
    variants: "{code}"
    composition: "{code}"
```

## Veto Conditions

- **NEVER** specify a component without accessibility requirements — they are not optional
- **NEVER** use raw color/spacing values — always reference design tokens
- **NEVER** skip interactive states — hover, focus, active, and disabled are mandatory
- **NEVER** create a component that duplicates an existing component's purpose
- **NEVER** omit keyboard interaction patterns — not all users use a mouse

## Completion Criteria

- [ ] Component purpose defined with clear scope
- [ ] All variants specified (size, intent, state, layout, content)
- [ ] Design tokens mapped with fallback chain
- [ ] Props/API fully documented with types and defaults
- [ ] Accessibility requirements complete (ARIA, keyboard, screen reader)
- [ ] Responsive behavior defined with touch targets
- [ ] Code examples provided for all major use cases
- [ ] Dark mode token values defined
