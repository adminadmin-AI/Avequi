---
task: respondIncident()
responsavel: "@omar-santos"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: incident_description
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: affected_systems
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: incident_report
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Incident classified with severity and timeline established"
  - "[ ] Containment actions executed and verified"
  - "[ ] Lessons learned documented with actionable improvements"
---

# Task: Incident Response Playbook

**Task ID:** CYBER-004
**Version:** 1.0.0
**Command:** `*respond-incident`
**Agent:** Omar Santos (omar-santos)
**Purpose:** Execute a structured incident response following the NIST 800-61 framework.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `incident_description` | User/alert system | YES |
| `affected_systems` | User or monitoring | YES |
| `incident_severity` | Initial triage | YES |
| `timeline_so_far` | User description | PREFERRED |
| `available_logs` | System logs | PREFERRED |
| `contacts_list` | Escalation contacts | NO |

## Preconditions

1. Incident has been reported or detected
2. Initial severity classification exists (P1-P4)
3. Affected systems or scope is at least partially identified
4. Responder has access to relevant systems and logs

## Execution Phases

### Phase 1: Preparation

1. Confirm incident response team roles and communication channels
2. Verify access to necessary tools — SIEM, log aggregators, forensic tools
3. Establish secure communication channel (out-of-band if compromise is suspected)
4. Review existing IR playbooks for similar incident types
5. Prepare evidence collection procedures — chain of custody, imaging tools
6. Confirm legal and compliance notification requirements

### Phase 2: Identification & Triage

1. Collect initial indicators of compromise (IOCs) — IPs, hashes, domains, user accounts
2. Determine incident type — malware, phishing, unauthorized access, data breach, insider threat
3. Establish timeline — when did it start, when was it detected, what happened between
4. Assess blast radius — which systems, data, and users are affected
5. Classify severity based on impact:
   - **P1 Critical** — Active data exfiltration, ransomware spreading, critical system down
   - **P2 High** — Confirmed compromise, lateral movement detected, sensitive data at risk
   - **P3 Medium** — Suspicious activity confirmed, limited scope, no data loss yet
   - **P4 Low** — Policy violation, failed attack, informational alert
6. Activate appropriate response level based on severity

### Phase 3: Containment

1. **Short-term containment** — Isolate affected systems, block malicious IPs/domains, disable compromised accounts
2. **Evidence preservation** — Capture memory dumps, disk images, log snapshots BEFORE changes
3. **Network containment** — Segment affected networks, update firewall rules, enable enhanced monitoring
4. **Credential containment** — Reset compromised credentials, revoke tokens, force re-authentication
5. **Communication** — Notify stakeholders per severity (P1/P2: immediate exec notification)
6. Verify containment effectiveness — confirm attacker access is severed

### Phase 4: Eradication

1. Identify root cause — vulnerability exploited, phishing vector, misconfiguration
2. Remove malware, backdoors, and unauthorized access mechanisms
3. Patch exploited vulnerabilities
4. Rebuild compromised systems from known-good baselines
5. Scan for residual indicators of compromise
6. Verify eradication — confirm no remaining attacker presence

### Phase 5: Recovery

1. Restore affected systems from clean backups
2. Gradually reintroduce systems to production with enhanced monitoring
3. Validate system integrity — checksums, baseline comparisons
4. Monitor for re-compromise indicators (minimum 72 hours enhanced monitoring)
5. Confirm all services restored and functioning normally
6. Update detection rules based on IOCs discovered

### Phase 6: Lessons Learned

1. Conduct post-incident review within 5 business days
2. Document complete incident timeline with decisions and outcomes
3. Identify what worked well and what needs improvement
4. Update IR playbooks based on lessons learned
5. Recommend security improvements to prevent recurrence
6. Create IOC packages for threat intelligence sharing (if appropriate)

## Output Format

```yaml
incident_report:
  incident_id: "IR-{YYYY}-{NNN}"
  responder: "omar-santos"
  severity: "P1 | P2 | P3 | P4"
  type: "{incident type}"
  status: "ACTIVE | CONTAINED | ERADICATED | RECOVERED | CLOSED"
  timeline:
    detected: "{timestamp}"
    contained: "{timestamp}"
    eradicated: "{timestamp}"
    recovered: "{timestamp}"
  affected_systems: ["{system list}"]
  iocs:
    - type: "IP | HASH | DOMAIN | EMAIL | USER"
      value: "{indicator}"
      context: "{where observed}"
  root_cause: |
    {Root cause analysis}
  remediation_actions: ["{actions taken}"]
  lessons_learned:
    what_worked: ["{positives}"]
    improvements: ["{areas to improve}"]
    recommendations: ["{prevent recurrence}"]
```

## Veto Conditions

- **NEVER** skip evidence preservation before containment actions
- **NEVER** restore systems without verifying backup integrity
- **NEVER** declare incident closed without enhanced monitoring period
- **NEVER** share IOCs or incident details without authorization
- **NEVER** blame individuals — focus on process and system improvements

## Completion Criteria

- [ ] Incident classified with severity and type
- [ ] Timeline established from detection to current state
- [ ] Containment actions executed and verified
- [ ] Root cause identified
- [ ] Eradication confirmed with no residual compromise
- [ ] Systems restored with enhanced monitoring active
- [ ] Lessons learned documented with actionable improvements
