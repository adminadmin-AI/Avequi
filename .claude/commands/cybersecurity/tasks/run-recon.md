---
task: runRecon()
responsavel: "@cartographer"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: target
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: target_type
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: recon_report
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Passive and active reconnaissance completed"
  - "[ ] Directory and service enumeration completed"
  - "[ ] Attack surface mapped with high-value targets identified"
---

# Task: Reconnaissance & Enumeration

**Task ID:** CYBER-006
**Version:** 1.0.0
**Command:** `*run-recon`
**Agent:** Cartographer (cartographer) + Dirber (dirber)
**Purpose:** Conduct systematic reconnaissance and enumeration of authorized targets.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `target` | User specification | YES |
| `target_type` | Domain, IP, range, webapp | YES |
| `authorization` | User confirmation | YES |
| `depth` | shallow, standard, deep | NO (default: standard) |
| `stealth_required` | Boolean | NO (default: false) |
| `known_information` | Prior intel | NO |

## Preconditions

1. Target is within authorized scope
2. Authorization confirmed for active scanning
3. Target type identified (domain, IP range, web application)
4. Network connectivity to target verified

## Execution Phases

### Phase 1: Passive Reconnaissance (cartographer)

1. **DNS Intelligence** — DNS records (A, AAAA, MX, NS, TXT, CNAME, SOA), zone transfers
2. **WHOIS & Registration** — Domain registration, registrar, name servers, creation/expiry
3. **Certificate Transparency** — SSL certificates, subdomains via CT logs (crt.sh)
4. **OSINT Collection** — Google dorking, Shodan queries, Censys, public breach databases
5. **Email Harvesting** — Collect email patterns, validate addresses (if in scope)
6. **Technology Fingerprinting** — Wappalyzer-style detection, HTTP headers, meta tags
7. **Social Media Recon** — LinkedIn employee enumeration, GitHub repos (if in scope)
8. Compile passive findings into structured inventory

### Phase 2: Active Reconnaissance (cartographer)

1. **Host Discovery** — Ping sweep, ARP scan (local networks), TCP SYN discovery
2. **Port Scanning** — Full TCP scan, top UDP ports, service version detection
3. **Service Fingerprinting** — Banner grabbing, protocol identification
4. **OS Detection** — TCP/IP stack fingerprinting, TTL analysis
5. **SSL/TLS Analysis** — Certificate details, cipher suites, protocol versions, vulnerabilities
6. **Network Topology** — Traceroute, hop analysis, firewall/WAF detection
7. If stealth required: reduce scan rate, use SYN scans, randomize port order

### Phase 3: Enumeration (dirber)

1. **Web Directory Enumeration** — Common paths, backup files, admin panels
2. **Virtual Host Discovery** — Subdomain brute-force, vhost enumeration
3. **API Endpoint Discovery** — Common API paths, version endpoints, documentation URLs
4. **User Enumeration** — Login forms, registration, password reset (timing/response differences)
5. **File Extension Scanning** — Sensitive file types (.bak, .sql, .env, .git, .DS_Store)
6. **CMS Detection** — WordPress, Drupal, Joomla plugins/themes enumeration
7. **Parameter Discovery** — Hidden GET/POST parameters, debug parameters

### Phase 4: Correlation & Reporting

1. Cross-reference passive and active findings — validate OSINT with scan results
2. Identify attack surface — exposed services, interesting endpoints, potential entry points
3. Map relationships — subdomain to IP, service to technology, user to role
4. Highlight high-value targets — admin panels, API gateways, legacy systems, dev/staging
5. Generate target profile document with prioritized attack vectors
6. Recommend next steps — vulnerability scanning, specific pentest focus areas

## Output Format

```yaml
recon_report:
  target: "{target}"
  recon_agent: "cartographer + dirber"
  depth: "shallow | standard | deep"
  stealth_mode: false
  passive_findings:
    dns_records: ["{records}"]
    subdomains: ["{subdomain list}"]
    technologies: ["{tech stack}"]
    emails: ["{harvested emails}"]
  active_findings:
    hosts: ["{alive hosts}"]
    open_ports: ["{port:service mappings}"]
    os_detection: ["{OS fingerprints}"]
    ssl_issues: ["{TLS findings}"]
  enumeration:
    directories: ["{discovered paths}"]
    api_endpoints: ["{API paths}"]
    interesting_files: ["{sensitive files}"]
  attack_surface:
    high_value_targets: ["{prioritized targets}"]
    potential_vectors: ["{attack paths}"]
    recommended_next_steps: ["{actions}"]
```

## Veto Conditions

- **NEVER** scan targets without authorization
- **NEVER** perform active scans when only passive recon was authorized
- **NEVER** attempt to exploit discovered vulnerabilities during recon
- **NEVER** enumerate users for credential stuffing purposes
- **NEVER** ignore stealth requirements when specified

## Completion Criteria

- [ ] Passive reconnaissance completed with structured findings
- [ ] Active scanning executed within authorized scope
- [ ] Directory and service enumeration completed
- [ ] Findings correlated and cross-referenced
- [ ] Attack surface mapped with high-value targets identified
- [ ] Next steps recommended for further assessment
