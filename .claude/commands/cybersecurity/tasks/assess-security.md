---
task: assessSecurity()
responsavel: "@cyber-chief"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: target_description
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: scope_definition
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: security_assessment
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Authorization confirmed and scope defined"
  - "[ ] All findings classified with CVSS scores"
  - "[ ] Remediation roadmap generated with priorities"
---

# Task: Security Posture Assessment

**Task ID:** CYBER-001
**Version:** 1.0.0
**Command:** `*assess-security`
**Agent:** Cyber Chief (cyber-chief) routes to specialists
**Purpose:** Perform a comprehensive security posture assessment of a target system or organization.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `target_description` | User prompt | YES |
| `scope_definition` | User or engagement docs | YES |
| `authorization_proof` | User confirmation | YES |
| `existing_reports` | Previous assessments | NO |
| `compliance_requirements` | Regulatory context | NO |

## Preconditions

1. Written authorization for the assessment scope is confirmed
2. Target description includes network ranges, applications, or org details
3. Ethical framework acknowledged — no destructive operations

## Execution Phases

### Phase 1: Scope Definition (cyber-chief)

1. Clarify assessment objectives (compliance, risk, pre-pentest, incident-driven)
2. Define in-scope and out-of-scope assets
3. Identify assessment type: external, internal, hybrid
4. Confirm rules of engagement (time windows, restricted hosts, escalation contacts)
5. Route sub-tasks to appropriate specialists based on scope

### Phase 2: Reconnaissance & Data Gathering

1. **Passive reconnaissance** — OSINT, DNS records, certificate transparency (cartographer)
2. **Active scanning** — Port scanning, service enumeration (command-generator for tool commands)
3. **Application mapping** — Web app endpoints, API surfaces (jim-manico)
4. **Network topology** — Identify segments, trust boundaries, egress points (chris-sanders)
5. Aggregate all findings into a structured inventory

### Phase 3: Analysis & Risk Scoring

1. Map discovered assets against known vulnerability databases
2. Classify findings using CVSS 3.1 scoring
3. Identify attack paths and lateral movement opportunities (peter-kim)
4. Assess defensive controls in place (chris-sanders)
5. Cross-reference against compliance requirements (if applicable)
6. Prioritize risks: Critical > High > Medium > Low > Informational

### Phase 4: Report Generation

1. Executive summary — business risk in non-technical language
2. Technical findings — each vulnerability with evidence, CVSS score, remediation
3. Attack surface map — visual representation of exposed assets
4. Remediation roadmap — prioritized actions with effort estimates
5. Quick wins — items fixable within 24-48 hours
6. Strategic recommendations — long-term security improvements

## Output Format

```yaml
security_assessment:
  target: "{target name}"
  scope: "{assessment scope}"
  date: "{assessment date}"
  assessor: "cyber-chief + specialists"
  executive_summary: |
    {Business-level risk overview}
  findings:
    - id: "FIND-001"
      title: "{finding title}"
      severity: "CRITICAL | HIGH | MEDIUM | LOW | INFO"
      cvss_score: 0.0
      description: "{detailed description}"
      evidence: "{proof of finding}"
      remediation: "{fix recommendation}"
      effort: "QUICK_WIN | SHORT_TERM | LONG_TERM"
  attack_surface:
    external_exposure: "{summary}"
    internal_risks: "{summary}"
  remediation_roadmap:
    immediate: ["{quick wins}"]
    short_term: ["{1-4 week items}"]
    long_term: ["{strategic improvements}"]
```

## Veto Conditions

- **NEVER** perform assessment without confirmed authorization
- **NEVER** scan or enumerate out-of-scope targets
- **NEVER** attempt exploitation during a posture assessment (that requires a separate pentest engagement)
- **NEVER** share findings with unauthorized parties
- **NEVER** downplay critical findings for convenience

## Completion Criteria

- [ ] Authorization confirmed and documented
- [ ] Scope clearly defined with in/out boundaries
- [ ] Passive and active reconnaissance completed
- [ ] All findings classified with CVSS scores
- [ ] Remediation roadmap generated with priorities
- [ ] Executive summary written in business language
- [ ] Report delivered in structured format
