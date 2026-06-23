---
task: generateCommands()
responsavel: "@command-generator"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: objective
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: target
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: command_output
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Appropriate tool selected with reasoning"
  - "[ ] Command generated with inline documentation"
  - "[ ] Safety assessment completed with warnings"
---

# Task: Security Tool Command Generation

**Task ID:** CYBER-005
**Version:** 1.0.0
**Command:** `*generate-commands`
**Agent:** Command Generator (command-generator)
**Purpose:** Generate precise, safe, and context-appropriate security tool commands for authorized operations.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `objective` | User prompt | YES |
| `target` | User specification | YES |
| `tool_preference` | User or auto-select | NO |
| `authorization_context` | User confirmation | YES |
| `constraints` | Rate limits, stealth, time | NO |
| `os_context` | Target OS/environment | PREFERRED |

## Preconditions

1. Operation is authorized (CTF, pentest engagement, educational, defensive)
2. Target is within authorized scope
3. Tool availability confirmed or installable
4. Objective is clearly defined (recon, enum, vuln scan, exploit, defense)

## Execution Phases

### Phase 1: Identify Objective & Target

1. Parse the user's objective — what are they trying to achieve?
2. Classify operation type: reconnaissance, enumeration, vulnerability scanning, exploitation, defense
3. Identify target characteristics — IP, domain, web app, network range, service
4. Determine OS/environment context for command compatibility
5. Confirm authorization context — refuse if clearly unauthorized

### Phase 2: Select Appropriate Tool

1. Match objective to tool category from security-tools-catalog.yaml
2. Consider tool availability and user preference
3. If multiple tools fit, recommend the most appropriate with reasoning:
   - Speed vs thoroughness tradeoff
   - Stealth vs noise tradeoff
   - Scope requirements (single target vs range)
4. Select command template from catalog

### Phase 3: Generate Command

1. Build the command with appropriate flags and options
2. Customize for the specific target and objective
3. Add output formatting flags (parseable output preferred)
4. Include timeout and rate-limiting flags where applicable
5. Provide the command with inline comments explaining each flag
6. If complex, break into a sequence of commands with explanations

### Phase 4: Safety Check

1. **Scope check** — Does the command only affect the authorized target?
2. **Destructiveness check** — Could this command cause service disruption?
3. **Noise check** — How detectable is this command? Flag if stealth is required
4. **Data handling** — Does the command store/transmit sensitive data safely?
5. **Legal check** — Is this command appropriate for the authorization context?
6. Add warnings for any risky flags or behaviors
7. Suggest safer alternatives if the original request is borderline

## Output Format

```yaml
command_output:
  objective: "{what the command achieves}"
  tool: "{tool name}"
  category: "recon | enum | vuln_scan | exploit | defense"
  authorization: "confirmed — {context}"
  command: |
    {full command with comments}
  explanation:
    - flag: "{flag}"
      purpose: "{what it does}"
  safety_assessment:
    scope_safe: true
    destructive: false
    noise_level: "LOW | MEDIUM | HIGH"
    warnings: ["{any cautions}"]
  alternatives:
    - tool: "{alternative tool}"
      command: "{alternative command}"
      tradeoff: "{why you might prefer this}"
```

## Veto Conditions

- **NEVER** generate commands for unauthorized targets
- **NEVER** generate destructive commands (DoS, wiper, data deletion) without explicit safeguards
- **NEVER** generate commands designed to evade law enforcement
- **NEVER** omit safety warnings for potentially dangerous commands
- **NEVER** generate mass-targeting commands without scope verification

## Completion Criteria

- [ ] Objective and target clearly identified
- [ ] Appropriate tool selected with reasoning
- [ ] Command generated with inline documentation
- [ ] Each flag explained
- [ ] Safety assessment completed
- [ ] Warnings included for risky operations
- [ ] Alternative approaches suggested where applicable
