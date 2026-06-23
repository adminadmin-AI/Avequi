---
task: diagnoseCybersecurity()
responsavel: "@cyber-chief"
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
    origem: data/routing-catalog.yaml
    obrigatorio: true

Saida:
  - campo: diagnosis
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] User intent parsed and ethical gate evaluated"
  - "[ ] Cross-cutting answer delivered to user"
  - "[ ] Routing suggestion provided"
---

# Task: Diagnose & Route — Cybersecurity Squad

## Metadata

| Field         | Value                                          |
|---------------|------------------------------------------------|
| Task ID       | `cybersecurity:diagnose`                       |
| Command       | `@cybersecurity` or `@cybersecurity:cyber-chief` |
| Orchestrator  | `cyber-chief`                                  |
| Version       | 1.0.0                                          |
| Created       | 2026-03-05                                     |

## Purpose

Analyze the user's cybersecurity question, provide an immediate cross-cutting answer,
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
3. Ethical authorization context is considered for all offensive requests

## Execution Phases

### Phase 1: Parse Request

1. Extract the core question or intent from the user message
2. Identify keywords, security domains, and technical context
3. Determine request category: offensive, defensive, operational, strategic, or educational
4. **ETHICAL GATE:** If the request involves offensive operations, verify:
   - Is this for an authorized pentest, CTF, or educational context?
   - If unclear, ASK for authorization context before proceeding
   - If clearly malicious intent, REFUSE with explanation

### Phase 2: Match Routing Catalog

1. Load `data/routing-catalog.yaml`
2. Match extracted keywords against domain keyword lists
3. Score each domain by keyword overlap and contextual relevance
4. Identify `primary_agent` and `secondary_agent` for the top-scoring domain
5. If multiple domains score equally, prefer the one closest to the user's explicit intent

### Phase 3: Cross-Cutting Answer

**MANDATORY — Always execute this phase before any routing.**

1. Provide an immediate, useful answer to the user's question
2. The answer should be actionable and demonstrate domain competence
3. Include relevant context: concepts, quick guidance, best practices
4. For offensive requests: include ethical reminders and scope boundaries
5. This answer must stand alone — even if the user never follows the routing suggestion

### Phase 4: Confidence Assessment

Assess routing confidence:

| Level  | Criteria                                      | Action                        |
|--------|-----------------------------------------------|-------------------------------|
| HIGH   | Clear keyword match, single domain, unambiguous | Route to primary agent       |
| MEDIUM | Multiple domains match, slight ambiguity       | Suggest primary + secondary   |
| LOW    | No clear match, vague request, cross-domain    | Stay with chief, ask clarifying questions |

## Output Format

```yaml
diagnosis:
  intent: "{parsed user intent}"
  category: "offensive | defensive | operational | strategic | educational"
  ethical_clearance: "cleared | needs_authorization | refused"
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
- **NEVER** provide offensive guidance without ethical authorization context
- **NEVER** assist with explicitly malicious, unauthorized, or destructive operations
- **NEVER** route tool agents (tier 2) directly without confirming the operational context

## Completion Criteria

- [x] User intent parsed and categorized
- [x] Ethical gate evaluated (for offensive requests)
- [x] Routing catalog consulted and domain matched
- [x] Cross-cutting answer delivered to user
- [x] Confidence level assessed
- [x] Routing suggestion provided (if confidence >= MEDIUM)
- [x] No specialist agent files loaded during diagnosis
