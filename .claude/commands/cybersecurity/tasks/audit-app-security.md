---
task: auditAppSecurity()
responsavel: "@jim-manico"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: application_url
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: tech_stack
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: app_security_audit
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Threat model created with STRIDE analysis"
  - "[ ] All OWASP Top 10 categories tested"
  - "[ ] Remediation plan with code-level fix examples"
---

# Task: OWASP Application Security Audit

**Task ID:** CYBER-003
**Version:** 1.0.0
**Command:** `*audit-app-security`
**Agent:** Jim Manico (jim-manico)
**Purpose:** Conduct a comprehensive application security review based on OWASP methodology.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `application_url` | User prompt | YES |
| `source_code_access` | Repository or files | PREFERRED |
| `tech_stack` | User or auto-detected | YES |
| `authentication_type` | User description | YES |
| `api_documentation` | OpenAPI/Swagger | NO |
| `previous_audit` | Prior findings | NO |

## Preconditions

1. Application is accessible for testing (URL or local environment)
2. Authorization to test the application is confirmed
3. Tech stack is identified (language, framework, database, auth provider)
4. Testing account credentials provided (if authenticated areas are in scope)

## Execution Phases

### Phase 1: Threat Modeling

1. Identify application architecture — frontend, backend, database, third-party services
2. Map data flows — user input paths, API calls, data storage, external integrations
3. Identify trust boundaries — auth layers, privilege levels, network segments
4. Create threat model using STRIDE methodology:
   - **S**poofing — authentication weaknesses
   - **T**ampering — data integrity risks
   - **R**epudiation — logging and audit gaps
   - **I**nformation Disclosure — data exposure risks
   - **D**enial of Service — resource exhaustion vectors
   - **E**levation of Privilege — authorization bypass paths
5. Prioritize threats by likelihood and impact

### Phase 2: Code Review (if source available)

1. Review authentication implementation — password hashing, session management, MFA
2. Analyze authorization logic — RBAC/ABAC enforcement, IDOR checks
3. Inspect input validation — sanitization, parameterized queries, output encoding
4. Check cryptographic usage — algorithm selection, key management, TLS config
5. Review error handling — information leakage, stack traces, debug endpoints
6. Assess dependency security — known vulnerable libraries (npm audit, Snyk)
7. Check security headers — CSP, HSTS, X-Frame-Options, CORS policy

### Phase 3: Vulnerability Scanning

1. Run automated scanner against OWASP Top 10 categories:
   - A01: Broken Access Control
   - A02: Cryptographic Failures
   - A03: Injection (SQL, NoSQL, Command, LDAP)
   - A04: Insecure Design
   - A05: Security Misconfiguration
   - A06: Vulnerable Components
   - A07: Authentication Failures
   - A08: Data Integrity Failures
   - A09: Logging & Monitoring Failures
   - A10: SSRF
2. Manual verification of automated findings (eliminate false positives)
3. Test business logic flaws not caught by scanners
4. API security testing — broken object-level auth, mass assignment, rate limiting

### Phase 4: Remediation Plan

1. Map each finding to OWASP category and CWE identifier
2. Provide specific code-level fix recommendations
3. Reference OWASP Cheat Sheets for each remediation
4. Prioritize fixes: Critical (patch now) > High (this sprint) > Medium (next sprint) > Low (backlog)
5. Provide secure code examples in the application's tech stack
6. Recommend security libraries and middleware

## Output Format

```yaml
app_security_audit:
  application: "{app name/url}"
  auditor: "jim-manico"
  methodology: "OWASP ASVS + Top 10"
  tech_stack: "{detected stack}"
  threat_model:
    architecture: "{description}"
    trust_boundaries: ["{boundary list}"]
    stride_findings: ["{threat list}"]
  findings:
    - id: "APP-001"
      owasp_category: "A01 — Broken Access Control"
      cwe: "CWE-284"
      title: "{finding}"
      severity: "CRITICAL | HIGH | MEDIUM | LOW"
      location: "{file:line or endpoint}"
      description: "{detailed description}"
      remediation: "{specific fix with code example}"
      cheat_sheet: "{OWASP cheat sheet URL}"
  remediation_plan:
    critical: ["{immediate fixes}"]
    high: ["{this sprint}"]
    medium: ["{next sprint}"]
    low: ["{backlog}"]
```

## Veto Conditions

- **NEVER** test authenticated areas without proper test credentials
- **NEVER** attempt destructive attacks against production systems
- **NEVER** ignore findings just because they are rated LOW
- **NEVER** recommend security-by-obscurity as a remediation
- **NEVER** skip manual verification of automated scanner results

## Completion Criteria

- [ ] Threat model created with STRIDE analysis
- [ ] Code review completed (if source available)
- [ ] All OWASP Top 10 categories tested
- [ ] False positives eliminated through manual verification
- [ ] Each finding mapped to OWASP category and CWE
- [ ] Remediation plan with code-level fix examples
- [ ] Secure coding references provided for each finding
