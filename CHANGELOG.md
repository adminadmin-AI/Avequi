# Changelog

Todas as mudanças notáveis do Avequi ERP. Formato baseado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento
[SemVer](https://semver.org/lang/pt-BR/) — ver [docs/VERSIONING.md](docs/VERSIONING.md).

## [Unreleased]

## [1.13.1] - 2026-07-13

### Added
- feat(api): preencher data/hora de saida (dhSaiEnt) na NF-e e transferencia (#724)

## [1.13.0] - 2026-07-13

### Added
- feat(api): descrição completa do veículo nas Informações Complementares (#722)

## [1.12.0] - 2026-07-13

### Added
- feat(api): assinatura Avecchi nas Informações Complementares do DANFE (#720)

## [1.11.1] - 2026-07-13

### Fixed
- fix(api): mapear erro_autorizacao da Focus como REJECTED com código/motivo SEFAZ (#718)

## [1.11.0] - 2026-07-13

### Added
- feat(api): token Focus por company — multi-emissor (loja Guarapuava + CRD) (#715)

### Fixed
- fix(api): estornar cartões autorizados no TEF ao cancelar a venda (#716)

## [1.10.0] - 2026-07-13

### Added
- feat(web): card Documentação Veicular na OV — status BIN/RENAVE/ATPV-e (#713)
- feat(api): integração BIN/RENAVE/ATPV-e via SERPRO — fila, clients e devolução (#712)

## [1.9.1] - 2026-07-11

### Added
- #347 fase 2 (347-A): infraestrutura de escopo por filial/loja em SHADOW (#708)

### Fixed
- fix(fiscal): guard W16-40 — NFC-e acima do limite exige identificação do consumidor (NT 2026.002) (#710)

## [1.9.0] - 2026-07-11

### Added
- feat(sec): rate limiting adaptativo — tracker por usuário + teto 2x p/ autenticados + exports 10/min (#349 parcial) (#706)

### Changed
- docs(iam): documentação as-built do IAM — arquitetura, fluxos, ER, matriz e receitas (#354) (#705)

## [1.8.0] - 2026-07-11

### Added
- feat(crm): motivos de perda estruturados — categoria obrigatória + dashboard acionável (Refs #570) (#703)
- feat(iam): reset de MFA por administrador (#545) (#702)
- feat(web): itens do Bloco G no nav filtram por permissão RBAC v2 (follow-up #696) (#701)

## [1.7.1] - 2026-07-11

### Fixed
- fix(rotas): BudgetModule e SchedulingModule antes dos pais + sentinela anti-shadowing (#698) (#699)

## [1.7.0] - 2026-07-11

### Added
- IAM v2 Bloco G (#341 parte 2): satélites (alert, carrier, scheduling, user, wms, delivery, vehicle-tracking/documents) no gate único RBAC v2 — +6 permissões (`sales.carriers.*`, `sales.deliveries.*`, `vehicle-tracking.documents.*`), catálogo 260→266 (#694)
- Varredura global de cobertura de gate (#353): toda rota da API exige classificação explícita (permissão, roles, @Public em allowlist exata ou exceção consciente) — regressão de endpoint sem guard quebra o CI (#693)

### Changed
- **@Roles legado ZERADO fora do CRM** — com o Bloco G, o RBAC v2 cobre A–E+G; resta só o Bloco F/CRM (#624) para fechar a #341. `rbac-matrix.spec` legado removido em favor da varredura global.
- `release.js` sincroniza o `package-lock.json` automaticamente após o bump (#692)

## [1.6.0] - 2026-07-10

### Added
- feat(payments): TEF multi-adquirente — registry por Acquirer.gateway + adapter Getnet (#596) (#690)
- feat(web): sidebar, command palette e RouteGuard filtram por permissão RBAC v2 (#351) (#689)

## [1.5.1] - 2026-07-10

### Fixed
- fix(fiscal): registra ManifestModule antes do FiscalModule — GET /fiscal/manifest era engolido pelo @Get(':id') (#686) (#687)

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

[Unreleased]: https://github.com/adminadmin-AI/Avequi/compare/v1.13.1...HEAD
[1.13.1]: https://github.com/adminadmin-AI/Avequi/compare/v1.13.0...v1.13.1
[1.13.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.11.1...v1.12.0
[1.11.1]: https://github.com/adminadmin-AI/Avequi/compare/v1.11.0...v1.11.1
[1.11.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.9.1...v1.10.0
[1.9.1]: https://github.com/adminadmin-AI/Avequi/compare/v1.9.0...v1.9.1
[1.9.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.7.1...v1.8.0
[1.7.1]: https://github.com/adminadmin-AI/Avequi/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/adminadmin-AI/Avequi/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/adminadmin-AI/Avequi/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/adminadmin-AI/Avequi/releases/tag/v1.0.0
