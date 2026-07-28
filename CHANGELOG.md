# Changelog

Todas as mudanças notáveis do Avequi ERP. Formato baseado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento
[SemVer](https://semver.org/lang/pt-BR/) — ver [docs/VERSIONING.md](docs/VERSIONING.md).

## [Unreleased]

## [1.21.0] - 2026-07-28

_Sem itens listados — edite antes de taggear._

## [1.20.0] - 2026-07-27

### Added
- feat(support): WP3 — incidente de suporte espelhado em issue do GitHub com contexto **redigido** (PII mascarada: CPF/CNPJ/e-mail/telefone; stack nunca sai, só assinatura), label `cliente:<tenant>` e vínculo `githubIssueNumber`; no-op sem `SUPPORT_GITHUB_TOKEN`/`SUPPORT_GITHUB_REPO` (#767 — PR #793)
- feat(support): WP4 — triagem repo-aware por IA: fila Bull `TRIAGE_QUEUE` → `repository_dispatch` → GitHub Action com checkout da release → LLM (forte no diagnóstico, barato na dedup) → write-back assinado (HMAC-SHA256 do corpo bruto, fail-closed) em `PATCH /support/incidents/:id/diagnosis`, gravando `diagnosis`/`triagedAt`/`severity` e comentando na issue; diagnosis é interno (cliente não vê) (#768 — PR #794)
- feat(chassi): 5 models `gdr_chassi_*` para a Marcadora de Chassi — séries, quadros, pool nunca-repetir, gravações (VIN unique) e eventos; contrato externo da ferramenta local (#782 — PR #792)

## [1.19.0] - 2026-07-27

### Added
- feat(finance): editar título de contas a pagar em aberto — `PATCH /finance/entries/:id` gateado pela permissão nova `finance.entries.update` (catálogo 302; FINANCEIRO e GERENTE_FINANCEIRO), com isolamento por empresa, reconciliação OPEN↔OVERDUE ao mudar vencimento, bloqueio com agendamento PENDENTE, rateio em 3 vias e auditoria com ator + diff (#789)
- feat(finance): previsão de pagamento (`expected_payment_date`, equivalente ao `data_previsao` do Omie) + fornecedor no Novo Lançamento (#788)
- feat(finance): fornecedor direto no título de contas a pagar, sem exigir Pedido de Compra (#785)

### Fixed
- fix(finance): rotas GET estáticas engolidas por `@Get(':id')` — 404 em categorias/centros de custo/contas bancárias (#787)
- fix(web): KPIs de Contas a Pagar refletem os filtros ativos (#784)
- fix(api): criação de usuário cria automaticamente o vínculo RBAC v2 espelho do papel legado — usuário novo nasce com `legacyFallback: false` (#779, refs #738)

## [1.18.0] - 2026-07-18

### Added
- feat(support): canal de reporte de bugs (épico #764) — reporter no app + "Meus chamados" (#765) e captura automática de erro 5xx com dedup (#766)

## [1.17.0] - 2026-07-18

### Added
- feat(fiscal): **Notas de Débito e Crédito IBS/CBS (finNFe 6/5, Ajuste SINIEF 49/2025) — HOMOLOGADAS na SEFAZ** (épico #753). Motor de diferença (`IbsCbsAdjustmentService`: espelho das alíquotas efetivas da original; modos integral/total/por item/valor avulso), builder de payload validado em 4 rodadas de homologação (crédito=entrada+referência no cabeçalho; débito=saída+`gDFeReferenciado` por item; CFOP por sentido e motivo), endpoints `POST /fiscal/:id/debit-note`/`credit-note` (permissões novas `fiscal.nfe.debit-note`/`credit-note` — catálogo 301) e preview em `POST /fiscal/:id/adjustment-preview` (#755, #756, #757, #759, #760 — PRs #772, #773, #775)
- feat(web): wizard de Nota de Débito/Crédito no detalhe da NF-e (espécie+motivo → valor → justificativa → revisão com preview vCBS/vIBS), badge+filtro de finalidade, card Documentos vinculados (original ↔ ajustes/devoluções), botão de NF-e de devolução manual e UI de inutilização de faixa (void-range) (#758 — PR #773)
- feat(support): módulo de suporte — chamados self-service com protocolo AVQ, página "Meus chamados" e captura automática de rota/versão (épico #764, WP1 #765 — PR #774)

### Fixed
- fix(fiscal): cancelamento e inutilização agora capturam protocolo e `mensagem_sefaz` da Focus (auditoria completa; `FiscalVoidRange.protocol` usa o protocolo real) e rejeições da Reforma (960/1026/1033/1106) chegam com orientação acionável (#727 — PR #772)

### Notes
- Nota de crédito por retorno/recusa (tpNFCredito 03/06) bloqueada com orientação para a NF-e de devolução — conflito de regras 327↔328 na SEFAZ-PR, documentado em `docs/faturamento/auditoria-homologacao-notas-debito-credito-2026-07-17.md`; cenário sentinela G3 no `audit-homologacao.ts` acusa quando a SEFAZ corrigir

## [1.16.0] - 2026-07-17

### Added
- feat(api): NF-e de devolução emitida pelo app — `FiscalListener` ouve a devolução da venda e cancela a NF-e na SEFAZ (≤24h) ou emite a NF-e de devolução referenciada (>24h, entrada 1202/2202, espelho dos tributos da original, veicProd preservado); endpoint manual `POST /fiscal/:id/return-note` com permissão nova `fiscal.nfe.return-note` (#747, #762)
- feat(api): schema fiscal da Reforma Tributária — enum `FiscalFinalidade` (finNFe 1-6, incl. Nota de Crédito/Débito do Ajuste SINIEF 49/2025), vínculo `referencedDocumentId` à NF-e original e campos `tipoNotaDebito`/`tipoNotaCredito`; fundação do épico #753 (#754, #762)
- feat(api): Fiscal Validator exige `notas_referenciadas` (chave de 44 dígitos) para finalidades 4/5/6 e `tipo_documento` 0 em devolução (#762)

### Fixed
- fix(api): devolução dentro de 24h agora cancela a NF-e NA SEFAZ — antes marcava CANCELLED apenas no banco e a nota seguia autorizada na SEFAZ (#762)
- fix(web): troca voluntária de senha volta ao Início após o sucesso (#751)

## [1.15.0] - 2026-07-16

### Added
- feat(web): telas de troca de senha — primeiro acesso / senha vencida (`/change-password`) e voluntária (`/app/account/password`), com anti-replay do token restrito (#743)
- feat(web): toggle Ativo/Inativo de usuários em settings/users, condicionado a `settings.users.update` (#744)

### Fixed
- fix(api): `PATCH /crm/settings` aceita os campos de escalação de SLA do #569 (save do CRM voltou a persistir) (#741)
- fix(api): toggle Ativo/Inativo de usuário — DTO aceita `isActive`; autoinativação bloqueada (403), proteção do último ADMIN_GLOBAL (409) e revogação de sessões ao inativar (#744)

## [1.14.0] - 2026-07-14

### Added
- feat(api): descrição do item da NF-e concatena o chassi (xProd) (#733)
- IAM Bloco F: migração RBAC v2 do CRM — família crm.* com 29 permissões (#726)

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

[Unreleased]: https://github.com/adminadmin-AI/Avequi/compare/v1.21.0...HEAD
[1.21.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.20.0...v1.21.0
[1.20.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.19.0...v1.20.0
[1.19.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.18.0...v1.19.0
[1.18.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.17.0...v1.18.0
[1.17.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.16.0...v1.17.0
[1.16.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.15.0...v1.16.0
[1.15.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.13.1...v1.14.0
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
