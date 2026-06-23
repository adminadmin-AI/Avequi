---
task: diagnoseDesignChallenge()
responsavel: "@design-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: user_message
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: routing_catalog
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: diagnosis
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] User intent parsed and categorized"
  - "[ ] Cross-cutting answer delivered to user"
  - "[ ] Confidence level assessed"
---

# Task: Diagnose & Route — Design Squad

## Metadata

| Field         | Value                                            |
|---------------|--------------------------------------------------|
| Task ID       | `design-squad:diagnose`                          |
| Command       | `@design-squad` or `@design-squad:design-chief`  |
| Orchestrator  | `design-chief`                                   |
| Version       | 1.0.0                                            |
| Created       | 2026-03-05                                       |

## Purpose

Analyze the user's design question, provide an immediate cross-cutting answer,
and determine whether specialist routing is needed. The chief NEVER loads a specialist
agent file during diagnosis — it only identifies the best route.

## Inputs

| Input            | Source              | Required |
|------------------|---------------------|----------|
| `user_message`   | User prompt         | YES      |
| `routing_catalog` | `data/routing-catalog.yaml` | YES |
| `config`         | `config/config.yaml` | YES     |
| `conversation_history` | Session context | NO       |

## Preconditions

1. User message is not empty
2. Routing catalog is loaded and accessible

## Execution Phases

### Phase 1: Parse Request

1. Extract the core question or intent from the user message
2. Identify keywords, design domains, and technical context
3. Determine the design domain: systems, operations, experience, or production
4. Determine the collaboration pattern if applicable:
   - Design system creation flow
   - New feature design flow
   - Design ops setup flow

### Phase 2: Match Routing Catalog

1. Load `data/routing-catalog.yaml`
2. Match extracted keywords against domain keyword lists
3. Score each domain by keyword overlap and contextual relevance
4. Identify `primary_agent` and `secondary_agent` for the top-scoring domain
5. If multiple domains score equally, consider the design domain to break ties:
   - Systems questions: prefer brad-frost
   - Operations questions: prefer dave-malouf
   - Experience questions: prefer ux-designer
   - Production questions: prefer design-system-architect or ui-engineer

### Phase 3: Cross-Cutting Answer

**MANDATORY — Always execute this phase before any routing.**

1. Provide an immediate, useful answer to the user's question
2. The answer should be actionable and demonstrate design domain competence
3. Include relevant context: methodologies, patterns, or design principles applicable
4. Reference the applicable design framework or methodology by name
5. This answer must stand alone — even if the user never follows the routing suggestion

### Phase 4: Confidence Assessment

Assess routing confidence:

| Level  | Criteria                                      | Action                        |
|--------|-----------------------------------------------|-------------------------------|
| HIGH   | Clear keyword match, single domain, unambiguous | Route to primary specialist  |
| MEDIUM | Multiple domains match, slight ambiguity       | Suggest primary + secondary   |
| LOW    | No clear match, vague request, cross-domain    | Stay with chief, ask clarifying questions |

## Output Format

```yaml
diagnosis:
  intent: "{parsed user intent}"
  design_domain: "systems | operations | experience | production"
  matched_domain: "{domain from routing catalog}"
  confidence: "HIGH | MEDIUM | LOW"
  primary_agent: "{agent-id}"
  secondary_agent: "{agent-id}"
  cross_cutting_answer: |
    {The immediate answer provided to the user}
  routing_suggestion: |
    {Why this specialist was chosen and what they can add}
```

## Veto Conditions

- **NEVER** route without providing a cross-cutting answer first
- **NEVER** route when confidence is LOW — stay with chief and ask clarifying questions
- **NEVER** load a specialist agent file during diagnosis — only identify the route
- **NEVER** trigger a multi-specialist collaboration flow during diagnosis — one specialist at a time
- **NEVER** default to brad-frost for every question — match the actual design domain

## Completion Criteria

- [x] User intent parsed and categorized
- [x] Design domain identified
- [x] Routing catalog consulted and domain matched
- [x] Cross-cutting answer delivered to user
- [x] Confidence level assessed
- [x] Routing suggestion provided (if confidence >= MEDIUM)
- [x] No specialist agent files loaded during diagnosis
