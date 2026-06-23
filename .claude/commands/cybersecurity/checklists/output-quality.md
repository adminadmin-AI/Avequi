# Security Output Quality Checklist

**Checklist ID:** CYBER-CL-001
**Referenced by:** tasks/review.md
**Purpose:** Validate cybersecurity deliverables for quality before delivery to user.

[[LLM: INITIALIZATION INSTRUCTIONS

This checklist validates cybersecurity output specifically.

EXECUTION APPROACH:
1. For each category, verify every item against the deliverable
2. Mark items as [x] Pass, [ ] Fail, [N/A] Not Applicable
3. CRITICAL items block delivery; non-critical items are advisory

CRITICAL items are marked with (CRITICAL) suffix.]]

---

## 1. Authorization & Scope

- [ ] Authorization boundaries are verified and respected (CRITICAL)
- [ ] Scope of assessment is explicitly stated (CRITICAL)
- [ ] Out-of-scope items are documented and not tested
- [ ] Legal and compliance constraints acknowledged
- [ ] Engagement rules of engagement (RoE) followed

## 2. Findings Classification

- [ ] Each finding has a severity rating: Critical, High, Medium, Low, Informational (CRITICAL)
- [ ] Severity ratings use CVSS or equivalent standardized scoring
- [ ] MITRE ATT&CK technique IDs mapped where applicable
- [ ] CWE/CVE references included for known vulnerabilities
- [ ] False positives are identified and filtered

## 3. Evidence & Reproducibility

- [ ] Each finding includes evidence: logs, screenshots, PoC steps (CRITICAL)
- [ ] Findings are reproducible by a third party following the documentation
- [ ] Attack vectors are clearly described
- [ ] Impact is stated in business terms, not just technical terms
- [ ] Affected assets/components are specifically identified

## 4. Remediation

- [ ] Every finding has an actionable remediation recommendation (CRITICAL)
- [ ] Remediation is prioritized by severity and exploitability
- [ ] Short-term mitigations distinguished from long-term fixes
- [ ] Remediation steps are specific, not generic ("patch your systems")
- [ ] Compensating controls suggested where immediate fix is not possible

## 5. Reporting & Confidentiality

- [ ] No sensitive data exposed in the report (credentials, PII, internal IPs in plain text) (CRITICAL)
- [ ] Executive summary is present and understandable by non-technical stakeholders
- [ ] Technical detail is sufficient for the engineering team to act
- [ ] Report follows a recognized framework structure (OWASP, NIST, PTES)
- [ ] Classification/confidentiality marking applied

## 6. Completeness

- [ ] All in-scope assets/surfaces were assessed
- [ ] Methodology is documented
- [ ] Tools and versions used are listed
- [ ] Limitations and caveats are disclosed
- [ ] Recommendations for future assessments included

---

## PASS/FAIL Criteria

**PASS:** All CRITICAL items [x] and fewer than 3 non-critical failures.
**REVISE:** All CRITICAL items [x] but 3+ non-critical failures.
**FAIL:** Any CRITICAL item unchecked.
