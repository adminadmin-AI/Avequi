# Changelog

Todas as mudanças notáveis do Avequi ERP. Formato baseado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento
[SemVer](https://semver.org/lang/pt-BR/) — ver [docs/VERSIONING.md](docs/VERSIONING.md).

## [Unreleased]

## [1.5.0] - 2026-07-10

### Added
- IAM v2 (#341 parte 2, PR E2/E3): fiscal, compliance, LGPD e approvals no gate único RBAC v2 + cortes de permissões fiscais do GERENTE_FINANCEIRO (#683)

### Changed
- **Fecha o Bloco E da migração IAM v2** — com E2/E3, o RBAC v2 cobre A (analytics/report/audit), B (cadastros), C (vendas/estoque), D (compras/produção/qualidade), E1 (financeiro/FP&A) e E2/E3 (fiscal/LGPD/approval). Catálogo consolidado em 260 permissões · 28 perfis system.
- `package-lock.json` sincronizado com a versão do produto (estava defasado em 1.2.0)

## [1.4.1] - 2026-07-10

### Added
- Seguranca (#202): validacao completa de env vars no bootstrap (JWT refresh, webhook fiscal, chave bancaria) (#455)
- sec(iam): security headers + CSP report-only via Helmet (#349 parcial) (#497)

## [1.4.0] - 2026-07-09

### Added
- feat(fiscal): grupo card no detPag da NF-e — tpIntegra=1 (#587) (#680)
- feat(customers): tags de segmentação, anexos e birthDate (#476) (#679)
- feat(web): UI do plano de pagamento na OV + tela de adquirentes/taxas (#584 #585) (#678)
- feat(fiscal): Compliance Center — conformidade em tempo real (#503 parte 2) (#677)

### Fixed
- fix(fiscal): emitForTransfer deriva INTERNA/INTERESTADUAL das UFs e usa destinatário real (#676)

## [1.3.0] - 2026-07-09

### Added
- feat(crm): proposta em PDF da cotação direto no inbox (#572) (#673)
- feat(crm): aviso de duplicidade de lead entre lojas (#574) (#671)
- #341 parte 2 (PR E1): financeiro/banking/billing/FP&A no gate unico RBAC v2 + fix acquirer sem gate (Refs #341, Refs #623) (#670)
- feat(web): tela de Venda Balcão (PDV) + endpoint de chassis escopado (#595) (#669)
- feat(sales): venda balcão da filial (PDV) — sem separação, chassi no pedido (#595) (#668)
- feat(skill): reforma-tributaria — parametrização fiscal IBS/CBS assistida (#665)
- #341 parte 2 (PR D): compras/producao/qualidade no gate unico RBAC v2 + anti-IDOR RFQ (Refs #341, Refs #622) (#663)
- #341 parte 2 (PR C): vendas/estoque no gate unico RBAC v2 (Refs #341, Refs #621) (#633)
- feat(web): UI Expedição pós-NF-e (#496) (#661)

### Changed
- docs(spec): transferência de mercadoria entre filiais (NF-e saída+entrada) (#667)

## [1.2.0] - 2026-07-09

### Added
- #365 Entrega pós-NF-e (Delivery) + criação/transição automáticas (#646)
- #364 Documentos regulatórios do veículo (CAT/CCT/Projeto Técnico) (#645)
- feat(web): UI Análise de Investimentos (#399) (#653)
- feat(web): UI Budget por Drivers (#398) (#652)
- feat(web): UI Forecast Financeiro (#397) (#651)
- feat(web): UI Custeio por Absorção (#396) (#650)
- feat(web): UI Formação de Preço (#395) (#649)

### Changed
- docs: README com banner de onboarding + pointer no CLAUDE.md (#658)
- docs: guia de onboarding (docs/ONBOARDING.md) (#657)
- ci: liga Turbo Remote Cache (Vercel) (#656)
- ci: jobs paralelos (lint/build/test) + cache do turbo (#655)
- chore(ci): ESLint nos dois apps + workflow CI (lint/build/test) (#654)

## [1.1.0] - 2026-07-08

### Added
- #399 Análise de Investimentos — VPL, TIR, payback + alçada (#636)
- #397 Forecast financeiro — demanda→R$ + despesas por tendência (#635)
- #398 Budget dirigido por drivers — Volume × Preço × Mix (#634)
- #396 Custeio por absorção — CIF/hora rateado + custo material+MOD+CIF (#632)
- #395 Formação de Preço — calculadora custo + impostos + margem (#631)
- #628 Mover chassi (SerialNumber) na transferência entre depósitos (#629)
- feat(versioning): npm run changelog:draft — rascunho do CHANGELOG por PRs (#644)

### Fixed
- fix+feat(versioning): build-info no build context + npm run release:* (#643)

## [1.0.0] - 2026-07-08

Primeira versão sob a política de versionamento. Marca o ERP como produto em
produção (GDR faturando NF-e real), não mais `0.x` protótipo.

### Added
- Política de versionamento SemVer + `docs/VERSIONING.md` e este `CHANGELOG.md`.
- Endpoint público `GET /api/version` (`version`, `gitSha`, `builtAt`, `env`).
- `gitSha`/`builtAt` estampados no deploy (`npm run deploy:api` → `build-info.json`).

### Changed
- Swagger (`/docs`) passa a ler a versão do `package.json` (antes fixo em `1.0`).
- Rodapé do web (`apps/web`) exibe a versão do produto.
- `version` dos `package.json` alinhada em `1.0.0` (antes `0.1.0`).

### Baseline em produção (1.0.0)
- Fiscal: emissão NF-e/NFC-e (Focus NFe), grupo veículos, cancelamento.
- Financeiro: contas a pagar/receber, DRE, categorias, centros de custo, conciliação OFX.
- Estoque/WMS, Produção/MRP, Compras, Vendas, Transferências entre lojas.
- CRM de lojas (captação multicanal, WhatsApp, funil).
- IAM v2 — controle de acesso por permissão (RBAC via `@RequirePermission`).

[Unreleased]: https://github.com/adminadmin-AI/Avequi/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/adminadmin-AI/Avequi/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/adminadmin-AI/Avequi/releases/tag/v1.0.0
