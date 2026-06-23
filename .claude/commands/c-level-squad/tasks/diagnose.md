---
task: diagnose()
responsavel: "@vision-chief"
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
  - "[ ] Query parsed with intent and business function"
  - "[ ] Quick answer provided"
  - "[ ] Route executed or direct answer given"
---

# Task: Diagnose — C-Level Squad

## Metadata

| Field         | Value                                              |
|---------------|----------------------------------------------------|
| Task ID       | `c-level:diagnose`                                 |
| Command       | `@c-level diagnose "{query}"`                      |
| Orchestrator  | `vision-chief`                                     |
| Purpose       | Parse the user's request, provide a quick answer, and route to the best C-suite executive |

## Inputs

| Input        | Source       | Required | Description                              |
|--------------|-------------|----------|------------------------------------------|
| `query`      | User prompt | Yes      | The user's question or request           |
| `context`    | Session     | No       | Previous conversation context            |
| `role_hint`  | User/Auto   | No       | Suggested C-level role (CEO, COO, etc.)  |

## Preconditions

- Squad config loaded (`config/config.yaml`)
- Routing catalog available (`data/routing-catalog.yaml`)
- At least one specialist agent definition exists in `agents/`

## Phases

### Phase 1: Parse (vision-chief)

1. Read the user's query and extract:
   - **Intent**: What the user wants to accomplish
   - **Domain keywords**: Match against routing catalog keywords
   - **Business function**: Which C-suite domain (vision, ops, marketing, tech, infra, AI)
   - **Complexity**: Simple (direct answer) vs Complex (needs specialist)

2. Classify the query type:
   - `question` — Needs an informational answer
   - `strategy` — Needs a strategic plan or direction
   - `decision` — Needs executive-level decision framework
   - `assessment` — Needs evaluation of current state
   - `transformation` — Needs change management or digital transformation plan

### Phase 2: Match Routing

1. Load `data/routing-catalog.yaml`
2. Score each domain against extracted keywords
3. Identify:
   - **Primary agent**: Best match (highest keyword overlap)
   - **Secondary agent**: Backup or complementary perspective
   - **Confidence level**: HIGH (>= 3 keyword matches), MEDIUM (2 matches), LOW (0-1 matches)

4. Executive routing guide:
   | Problem Area                | Primary Agent    | Secondary Agent  |
   |-----------------------------|------------------|------------------|
   | Vision/strategy/fundraising | vision-chief     | coo-orchestrator |
   | Operations/scaling/process  | coo-orchestrator | vision-chief     |
   | Marketing/brand/GTM         | cmo-architect    | vision-chief     |
   | Technology/architecture     | cto-architect    | cio-engineer     |
   | Infrastructure/security     | cio-engineer     | cto-architect    |
   | AI/ML/digital transformation| caio-architect   | cto-architect    |

### Phase 3: Answer

1. **Always provide a quick answer first** — 2-4 sentences that directly address the query
2. Include:
   - Direct response to the question from a CEO perspective
   - Which executive role is most relevant
   - What strategic depth the specialist would add

### Phase 4: Route (if needed)

1. If confidence is HIGH or MEDIUM:
   - Announce the routing target: "Routing to @{agent} for executive counsel"
   - Pass context: original query + parsed intent + business function
2. If confidence is LOW:
   - Do NOT route — answer directly as vision-chief
   - Offer the user a choice of executives if the query spans multiple domains

## Output Format

```yaml
diagnosis:
  query_summary: "{1-line summary}"
  intent: "{question|strategy|decision|assessment|transformation}"
  business_function: "{vision|operations|marketing|technology|infrastructure|ai}"
  quick_answer: |
    {2-4 sentence direct answer}
  routing:
    confidence: "{HIGH|MEDIUM|LOW}"
    primary_agent: "{agent-id}"
    secondary_agent: "{agent-id}"
    reason: "{why this executive is the best match}"
  routed: {true|false}
```

## Veto Rules

1. **NEVER route without providing a quick answer first** — The user must always get immediate value
2. **NEVER route on LOW confidence** — Answer directly and offer choices instead
3. **NEVER route to more than one agent simultaneously** — Pick the best executive
4. **NEVER give tactical advice without strategic framing** — Always connect to business outcomes
5. **NEVER make promises about specific financial outcomes** — Provide frameworks, not guarantees

## Completion Criteria

- [ ] Query parsed with intent and business function classification
- [ ] Routing catalog consulted and confidence scored
- [ ] Quick answer provided (mandatory, regardless of routing)
- [ ] Route executed if confidence >= MEDIUM, or direct answer if LOW
- [ ] Output format matches the schema above
