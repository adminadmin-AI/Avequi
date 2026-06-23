---
task: diagnoseStorytelling()
responsavel: "@story-chief"
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
  - "[ ] User intent parsed and categorized"
  - "[ ] Cross-cutting answer delivered to user"
  - "[ ] Routing suggestion provided"
---

# Task: Diagnose & Route — Storytelling Squad

## Metadata

| Field         | Value                                          |
|---------------|------------------------------------------------|
| Task ID       | `storytelling:diagnose`                        |
| Command       | `@storytelling` or `@storytelling:story-chief` |
| Orchestrator  | `story-chief`                                  |
| Version       | 1.0.0                                          |
| Created       | 2026-03-05                                     |

## Purpose

Analyze the user's storytelling or narrative question, provide an immediate cross-cutting
answer, and determine whether specialist routing is needed. The chief NEVER loads a
specialist agent file during diagnosis — it only identifies the best route.

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
2. Identify keywords, narrative domains, and storytelling context
3. Determine the story scale: micro (anecdote, post), meso (presentation, episode), macro (screenplay, novel), or meta (movement, cultural)
4. Determine the narrative domain: mythic, structural, personal, business, performative, or movement

### Phase 2: Match Routing Catalog

1. Load `data/routing-catalog.yaml`
2. Match extracted keywords against domain keyword lists
3. Score each domain by keyword overlap and contextual relevance
4. Identify `primary_agent` and `secondary_agent` for the top-scoring domain
5. If multiple domains score equally, consider the story scale to break ties:
   - Micro scale: prefer matthew-dicks, kindra-hall, park-howell
   - Meso scale: prefer nancy-duarte, oren-klaff, dan-harmon, blake-snyder
   - Macro scale: prefer blake-snyder, shawn-coyne, joseph-campbell
   - Meta scale: prefer marshall-ganz, joseph-campbell

### Phase 3: Cross-Cutting Answer

**MANDATORY — Always execute this phase before any routing.**

1. Provide an immediate, useful answer to the user's question
2. The answer should be actionable and demonstrate narrative domain competence
3. Include relevant context: frameworks mentioned, quick storytelling guidance
4. Reference the applicable narrative principle or framework by name
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
  narrative_domain: "mythic | structural | personal | business | performative | movement"
  story_scale: "micro | meso | macro | meta"
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
- **NEVER** recommend a multi-specialist flow during diagnosis — one specialist at a time
- **NEVER** default to joseph-campbell for every question — match the actual domain

## Completion Criteria

- [x] User intent parsed and categorized
- [x] Narrative domain and story scale identified
- [x] Routing catalog consulted and domain matched
- [x] Cross-cutting answer delivered to user
- [x] Confidence level assessed
- [x] Routing suggestion provided (if confidence >= MEDIUM)
- [x] No specialist agent files loaded during diagnosis
