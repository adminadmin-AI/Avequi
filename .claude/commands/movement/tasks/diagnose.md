---
task: diagnose()
responsavel: "@movement-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: query
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: diagnosis
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Query parsed with intent and phase classification"
  - "[ ] Quick answer provided"
  - "[ ] Route executed or direct answer given"
---

# Task: Diagnose — Movement Squad

## Metadata

| Field         | Value                                              |
|---------------|----------------------------------------------------|
| Task ID       | `movement:diagnose`                                |
| Command       | `@movement diagnose "{query}"`                     |
| Orchestrator  | `movement-chief`                                   |
| Purpose       | Parse the user's request, provide a quick answer, and route to the best specialist agent |

## Inputs

| Input        | Source       | Required | Description                              |
|--------------|-------------|----------|------------------------------------------|
| `query`      | User prompt | Yes      | The user's question or request           |
| `context`    | Session     | No       | Previous conversation context            |
| `phase_hint` | User/Auto   | No       | Suggested movement phase (1-5)           |

## Preconditions

- Squad config loaded (`config/config.yaml`)
- Routing catalog available (`data/routing-catalog.yaml`)
- At least one specialist agent definition exists in `agents/`

## Phases

### Phase 1: Parse (movement-chief)

1. Read the user's query and extract:
   - **Intent**: What the user wants to accomplish
   - **Domain keywords**: Match against routing catalog keywords
   - **Movement phase**: Map to one of the 5 phases (Spark, Identity, Ignition, Growth, Impact)
   - **Complexity**: Simple (direct answer) vs Complex (needs specialist)

2. Classify the query type:
   - `question` — Needs an informational answer
   - `creation` — Needs a deliverable (manifesto, identity framework, etc.)
   - `analysis` — Needs deep analysis (phenomenology, impact measurement)
   - `strategy` — Needs a plan or roadmap

### Phase 2: Match Routing

1. Load `data/routing-catalog.yaml`
2. Score each domain against extracted keywords
3. Identify:
   - **Primary agent**: Best match (highest keyword overlap)
   - **Secondary agent**: Backup or complementary perspective
   - **Confidence level**: HIGH (>= 3 keyword matches), MEDIUM (2 matches), LOW (0-1 matches)

4. Movement phase mapping:
   | Phase              | Primary Agent          | Secondary Agent       |
   |--------------------|------------------------|-----------------------|
   | Spark              | fenomenologo           | movement-architect    |
   | Identity           | identitario            | manifestador          |
   | Ignition           | manifestador           | estrategista-de-ciclo |
   | Growth             | estrategista-de-ciclo  | analista-de-impacto   |
   | Impact             | analista-de-impacto    | movement-chief        |

### Phase 3: Answer

1. **Always provide a quick answer first** — 2-4 sentences that directly address the query
2. Include:
   - Direct response to the question
   - Which movement phase this relates to
   - What the recommended specialist would add

### Phase 4: Route (if needed)

1. If confidence is HIGH or MEDIUM:
   - Announce the routing target: "Routing to @{agent} for deeper analysis"
   - Pass context: original query + parsed intent + phase classification
2. If confidence is LOW:
   - Do NOT route — answer directly as movement-chief
   - Offer the user a choice of specialists if the query is ambiguous

## Output Format

```yaml
diagnosis:
  query_summary: "{1-line summary}"
  intent: "{question|creation|analysis|strategy}"
  movement_phase: "{spark|identity|ignition|growth|impact}"
  quick_answer: |
    {2-4 sentence direct answer}
  routing:
    confidence: "{HIGH|MEDIUM|LOW}"
    primary_agent: "{agent-id}"
    secondary_agent: "{agent-id}"
    reason: "{why this agent is the best match}"
  routed: {true|false}
```

## Veto Rules

1. **NEVER route without providing a quick answer first** — The user must always get immediate value
2. **NEVER route on LOW confidence** — Answer directly and offer choices instead
3. **NEVER route to more than one agent simultaneously** — Pick the best match
4. **NEVER skip phase classification** — Every query maps to a movement phase
5. **NEVER invent movement phases** — Only use the 5 defined phases

## Completion Criteria

- [ ] Query parsed with intent and phase classification
- [ ] Routing catalog consulted and confidence scored
- [ ] Quick answer provided (mandatory, regardless of routing)
- [ ] Route executed if confidence >= MEDIUM, or direct answer if LOW
- [ ] Output format matches the schema above
