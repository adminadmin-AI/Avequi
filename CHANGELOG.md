# Changelog

Todas as mudanças notáveis do Avequi ERP. Formato baseado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento
[SemVer](https://semver.org/lang/pt-BR/) — ver [docs/VERSIONING.md](docs/VERSIONING.md).

## [Unreleased]

## [1.44.0] - 2026-08-07

### Added
- feat(chassis): ano do chassi como coluna e filtro + reservados no painel (#889) (#1048)
- feat(chassis): mostra quais marcações a gravação concluiu (#889) (#1047)

### Fixed
- fix(web): breadcrumbs sem links mortos — agrupador de rota sem página sai da trilha (#1045)
- fix(chassis): status "Não concluída" + instalador v1.0.4 (#889) (#1046)
- fix(#1036): congela o relógio no getMyDay — fim do flaky de fuso no CI (#1044)

### Changed
- perf(#1032): export CSV server-side com cursor — respeitar filtros, não só a página (#1051)
- perf(#1031): monitor de reposição com join no servidor — fim do loop de páginas (#1049)

## [1.43.0] - 2026-08-07

### Added
- feat(#1028): liga o gate do list-query-lint como catraca sobre baseline (#1042)
- feat(#1028): contrato de paginação, endpoints de opções e modo servidor no DataTable (#1035)
- feat(#1028): list-query-lint — gate de CI para findMany sem teto (#1030)
- feat(nav): a marca vira o atalho para o início; sai o ícone de casinha (#1040)
- feat(chassis): download real do instalador OpenClaw na tela (#889) (#1034)
- feat(iam): unifica elegibilidade de vendedores no CRM (#1002) (#1012)

### Fixed
- fix(chassis): arquivo do instalador em português — Gravadora_de_Chassi (#889) (#1037)
- fix(sec): onda 2 do hardening — seed, alçada de preço, headers e deps (#1038)

### Changed
- perf(sdr): TTL de cache de 1h e custo de escrita correto por TTL (#1039)

## [1.42.0] - 2026-08-06

### Added
- feat(ops): contrato AVQ-CT v2 — minuta jurídica completa no gerador (#992/#1025) (#1026)

## [1.41.1] - 2026-08-05

### Fixed
- fix(ops): render do contrato em PDF — marcador WinAnsi-safe e rodapé sem páginas fantasma (#992) (#1020)

## [1.41.0] - 2026-08-05

### Added
- feat(crm): ranking de receita por loja no painel de carteira (#850) (#1009)
- feat(iam): migra comissões e sessões para permissões v2 (#1001) (#1008)

### Changed
- refactor(iam): remove gates legados redundantes (#1000) (#1007)
- ci(iam): executa invariante do último admin em PostgreSQL (#937) (#999)
- refactor(production): extrai BomExplosionService — explosão de BOM em ledger de arestas (#980) (#983)

## [1.40.0] - 2026-08-05

### Added
- feat(ux): escrita humana onda 4 — voice-lint no CI e consolidação settings/ops (#987) (#997)
- feat(ux): escrita humana onda 3 — vocabulário no corpo das telas (#987) (#996)
- feat(ux): escrita humana onda 2 — mensagens centralizadas, fim dos travessões e do jargão técnico (#987) (#995)

## [1.39.0] - 2026-08-05

### Added
- feat(ops): contrato de prestação de serviços em PDF — minuta AVQ-CT v1 (#992) (#993)

### Changed
- docs(ux): avecchi-voice proíbe travessão em texto de UI (#987) (#991)

## [1.38.0] - 2026-08-04

### Added
- feat(crm): conector de site multi-tenant — LP avecchi.ai capta lead pro tenant Avecchi (#962) (#989)
- feat(ux): escrita humana onda 1 — nav, títulos de página e skill avecchi-voice (#987) (#988)

## [1.37.0] - 2026-08-04

### Added
- feat(iam): torna RBAC v2 a fonte de verdade para papéis (#946) (#978)

### Fixed
- fix(iam): remove poderes críticos do enum legado (#947) (#982)
- fix(crm): conectores públicos de lead escopados ao tenant dono (#984) (#985)

## [1.36.0] - 2026-08-04

### Added
- feat(sidebar): favoritos e seções recolhidas por usuário, não por navegador (#975) (#977)
- feat(crm): venda SaaS — lead ganho abre onboarding do portal pré-preenchido (#962) (#976)

### Fixed
- fix(web): pouso por papel também no primeiro acesso com senha provisória (#973) (#974)

## [1.35.0] - 2026-08-04

### Added
- **Proposta comercial → assinatura (#963/#971)** — proposta nasce do preço de TABELA do plano (editável em Planos); valor negociado é desvio explícito e auditado; aceite cria assinatura + plano do tenant sem digitação dupla; proposta decidida é imutável (histórico comercial da conta) e vencida expira. Migration aditiva `20260804090000` (via `db execute`, #640).

## [1.34.0] - 2026-08-04

### Added
- **Ponte billing → financeiro da operadora (#960/#969)** — fatura de mensalidade espelha um título a receber no financeiro do tenant Avecchi (`OPERADORA_COMPANY_ID`; ausente = ponte desligada); baixa no portal liquida o título (anulação cancela); direção única (portal é a fonte); fail-soft com sweep diário idempotente de faturas órfãs. Migration aditiva `20260804060000` (via `db execute`, #640).

## [1.33.0] - 2026-08-04

### Added
- **Tela de MFA self-service (#936/#967)** — a verificação em duas etapas sai do curl e vira tela: `/app/account/security` com ativação por QR gerado no cliente (+ secret manual), confirmação TOTP, backup codes exibidos uma única vez (copiar/baixar, conclusão travada por confirmação de guarda), desativação com senha+código e regeneração de codes. Entradas pelo menu do avatar ("Segurança") e pelo botão "Ativar agora" nos acessos negados por MFA do console. API: `GET /auth/mfa/status` novo (nunca expõe secret).

## [1.32.0] - 2026-08-04

### Added
- **Painel da Operadora — home do console com KPIs SaaS (#957/#965)** — a home do console vira o painel de negócio: MRR (+New MRR do mês), ticket médio, contas por status (+novas no mês, sandbox à parte), inadimplência com tom pela idade do atraso, série de faturamento por competência (6 meses reais das faturas — sem interpolação), MRR por plano e alertas da carteira; CAC/LTV entram como slots "aguardando funil comercial" (épico #958). Metade financeira gateada por `ops.billing.view`. Lista de contas move para `/app/ops/tenants`. API: `GET /ops/panel/kpis` novo + `newMrrMonthCents`/`billedSeries` no `GET /ops/billing`.

## [1.31.0] - 2026-08-04

### Added
- **Console dedicado da operadora (OPS F2, #951/#953)** — sob `/app/ops` a casca troca para o console da Avecchi (wordmark + tag Operadora, navegação exclusiva); quem tem `ops.*` cai DIRETO no console após o login; **"Entrar no ERP"** em cada conta da lista abre o diálogo de entrada (usuário pré-selecionado + motivo) e cai dentro do ERP do cliente via impersonation WP6 (auditada, somente-leitura, 30 min); volta ao próprio ERP pelo menu do avatar. Sidebar do ERP ganha a porta única "Portal Avecchi".

### Fixed
- **Etapa de MFA no login (web)** — o front nunca tratou a resposta `mfaRequired` do `/auth/login`: conta com MFA ativo "logava" sem credencial e caía em loop de login. Agora o card troca para a verificação em duas etapas (TOTP/backup code) e segue o mesmo caminho de sessão do login normal (#953).

## [1.30.1] - 2026-08-03

### Fixed
- **Importador de centros de trabalho: timeout de 60s na transação (#873/#952)** — o default de 5s do Prisma não comportava ~34 creates seriais via pooler remoto e revertia o `--apply` inteiro; visto na carga real dos centros da GDR.

## [1.30.0] - 2026-08-03

### Added
- **Escopo por filial em vendas (347-B, #347/#930)** — o `SalesService` inteiro consome o escopo criado no 347-A, com contexto de acesso explícito USER×SYSTEM (esquecer o contexto é erro de compilação; chamadas internas usam `SYSTEM_CONTEXT` congelado) e recorte por depósito: usuário BRANCH vê e opera somente vendas dos depósitos das suas filiais (404 anti-enumeração fora do recorte; fail-closed em filial sem depósito; COMPANY prevalece em assignments mistos). Cache do escopo por empresa+usuário com invalidação junto do cache de permissões e fallback pro banco. Zero mudança de comportamento hoje — nenhum assignment com filial em produção.
- **Detalhe do pagável adaptado à forma de pagamento + "Parcela 1/10" (#929)** — o drawer do contas a pagar mostra nº/total da parcela (`installmentTotal`, backfill já aplicado em produção) e o histórico das ações registra o autor (baixa, cancelamento e parcelamento).

### Fixed
- **Proteção do último administrador global serializada com lock pessimista (#752/#938)** — elimina a corrida em que inativações/rebaixamentos simultâneos podiam passar pelo guard e deixar o tenant sem nenhum admin global.

## [1.29.1] - 2026-08-03

### Fixed
- **Boot da API quebrado na v1.29.0** (#933) — o `import default` do `cookie-parser` (CJS puro) compilava para `.default` inexistente (tsconfig sem `esModuleInterop`) e o bootstrap morria antes do listen; a v1.29.0 nunca passou no healthcheck do Railway (rollback automático manteve a 1.28.0 no ar, sem downtime). A v1.29.1 é a primeira versão da linha 1.29 efetivamente em produção.

## [1.29.0] - 2026-08-03

### Added
- **Blindagem multi-tenant (OPS WP7, #914/#931)** — fecha o épico Portal Avecchi (#915): suíte de isolamento cross-tenant com matriz automática de rotas e três fronteiras de escalação provadas contra o PermissionGuard real; tenant-query-lint (AST) no CI — query Prisma multi-tenant sem noção de tenant bloqueia o merge, com fixtures dos incidentes históricos (#36/#63/#216/#218); hardening `/ops`: throttle dedicado 30/min, MFA runtime e `OpsSessionGuard` (idade máxima de sessão 8h, `OPS_SESSION_MAX_AGE_MINUTES`); smoke pós-deploy `npm run smoke:isolation` no checklist de release.
- **Sessão em cookie httpOnly + proteção CSRF (#349/#903/#906)** — tokens saem do localStorage para cookies httpOnly (`gdr_access`/`gdr_refresh`) com CSRF double-submit (`gdr_csrf` + `x-csrf-token`, timingSafeEqual). Modo DUAL: canal Bearer segue funcionando e o front escolhe o canal pela resposta do login — nenhuma ordem de deploy quebra; sessões antigas migram sozinhas no primeiro refresh.

### Fixed
- **Guard de "último admin global" agora é por tenant (árvore matriz+filiais)** — contava admins de todos os tenants, permitindo inativar o único admin de uma conta enquanto outra tivesse admins (achado do tenant-query-lint, #914).
- **Dedup da triagem de suporte por IA escopado por tenant** — o contexto enviado ao LLM misturava protocolo+título de incidentes de outros tenants (achado do tenant-query-lint, #914).

## [1.28.0] - 2026-08-03

### Adicionado

**Portal Avecchi — WP5 e WP6 (épico #915)**
- **Billing da operadora F1** (#912/#925): assinatura por tenant (valor negociado, vencimento 1–28), fatura mensal gerada por cron idempotente (única por competência; SANDBOX/CHURNED nunca faturam), baixa manual auditada, MRR total/por plano + aging em `/app/ops/billing`, e régua de inadimplência — D+3 e-mail (uma vez), D+10 banner persistente no app do cliente (`GET /billing/me/status`), D+20 proposta de suspensão como alerta no portal (suspender segue manual). Gateway automático = fase 2.
- **Impersonation read-only auditada** (#913/#927): "Ver como o cliente" com token dedicado de 30 min (nenhuma sessão do cliente é tocada), motivo obrigatório, guard global rejeitando TODA mutação na API, banner com countdown + encerramento antecipado (denylist), e transparência dos dois lados — timeline do portal e card "Acessos do suporte" visível ao admin do tenant. Modo escrita com re-MFA deferido.

### Infra
- Migration aditiva idempotente: `20260803120000_ops_wp5_billing` (via `db execute`, #640). WP6 sem DDL.
- Catálogo RBAC: +3 permissões (`ops.billing.{view,manage}`, `ops.impersonation.execute`) — 319.

## [1.27.0] - 2026-08-03

### Adicionado

**Portal Avecchi — control plane da operadora** (épico #915, WP1–WP4)
- **Fundação** (#908/#916): ciclo de vida de tenant (`TRIAL/ACTIVE/SUSPENDED/CHURNED/SANDBOX`) na empresa raiz com cascata pras filiais; namespace RBAC `ops.*` EXCLUSIVO da operadora (nenhum perfil de cliente recebe — travado em teste); perfil `AVECCHI_OPERATOR` com **MFA obrigatório duro** nas rotas `/ops`; tenant suspenso não loga (403 pós-senha, anti-enumeração intacta) e tem as sessões revogadas na hora.
- **Provisionamento** (#909/#919): onboarding como máquina de estados idempotente e retomável por CNPJ — empresa → **convite de admin por e-mail com token de uso único** (72h, sha256, nunca senha em texto; aceite público em `/invite/accept` define a senha pela política #345) → checagem fiscal (exige `FOCUS_NFE_TOKEN__<companyId>` escopado, #695) → go-live com gate manual do operador. Wizard completo em `/app/ops/new`.
- **Painel de contas** (#910/#921): metering diário por tenant (`gdr_tenant_usage_dailies` — usuários ativos, NF-e, leads, erros 5xx; cron 03:15 com backfill de 90 dias na primeira execução) alimentando lista com resumo de uso, drill-down com abas (Visão geral com sparklines · Saúde · Pessoas · Linha do tempo) e **alertas da carteira** (sem login 7d, pico de 5xx, rejeição SEFAZ >20%, trial vencendo).
- **Planos & Entitlements** (#911/#922): o que cada conta usa vira dado governado pelo portal — catálogo de módulos em código (`crm`, `renave`*, `suporteIa`, `tef`, `maxUsers`), resolução exceção > plano > desligado (fail-closed), **tenant sem plano = legado (tudo liberado)**; trocar plano muda o app do cliente em ≤60s **sem redeploy**. CRM inteiro atrás do entitlement; limite de usuários com teto duro; 3 planos seedados (Essencial/Profissional/Industrial) sem atribuição automática. *`renave` é gate comercial — o runtime fiscal segue em `renaveEnabled`+SERPRO.
- **Expiração de sessão por inatividade de verdade** (#341/#920): a sessão morre após `SESSION_IDLE_TIMEOUT_MINUTES` (default 15) sem NENHUMA requisição — e cada requisição empurra o relógio (com debounce). Antes, `lastActivityAt` só mudava na rotação do refresh.
- **Endereço oficial da API: api.avecchi.ai** (#917) — docs e webhook Focus.

### Corrigido
- **Sessão derrubava o usuário a cada ~30 min** (#918): o interceptor web guardava só o `accessToken` da renovação e mantinha o refresh já revogado pela rotação; e N chamadas com 401 simultâneo disparavam N refreshes concorrentes. Agora persiste o PAR rotacionado e a renovação é single-flight.
- **Config do CRM não fica mais em loading eterno no 403** (#739/#907).

### Infra
- Migrations aditivas e idempotentes (aplicar via `db execute`, #640): `20260802120000_ops_wp1_tenant_lifecycle`, `20260802150000_ops_wp2_provisioning`, `20260802180000_ops_wp3_tenant_usage`, `20260802210000_ops_wp4_plans_entitlements`.
- Seeds: `db:seed:iam` (perfil `AVECCHI_OPERATOR` + permissões `ops.*`, catálogo 316) e planos (3 templates, sem atribuição a tenants).
- Catálogo RBAC: `ADMIN_GLOBAL`/`ADMIN_EMPRESA` migram de `allPermissionCodes()` para `tenantPermissionCodes()` — admin de cliente **não** recebe `ops.*`.

## [1.26.0] - 2026-08-01

### Adicionado

**Workspace Vivo — a Home vira mesa de trabalho** (desafio de 13 pontos, 31/07–01/08)
- **Minha Mesa** (#897, #898): "Minhas Pendências" vira inbox unificado e priorizado (crítico → atenção → informação). Fontes: aprovações na alçada, follow-ups de CRM, inspeções, **cobrança vencida** (recebíveis somados), **expedição parada** (venda faturada sem documento do veículo, crítica a partir de 3 dias) e **cliente aguardando** (SLA de 1ª resposta estourado, sempre no escopo do próprio usuário).
- **Meu Dia** (#899): novo `GET /workspace/my-day?days=1..90` — faturado, recebido e produzido **hoje**, mais a variação real contra o período anterior. Sem meta e sem streak (dependem do épico #867/#868); período anterior zerado devolve `null` e a interface diz "sem base", nunca um percentual inventado. "Hoje" é meia-noite em `America/Sao_Paulo`, não o UTC do contêiner.
- **Tiers de tamanho P/M/G** (#902): grid de 12 colunas (P=4 · M=6 · G=12) e seletor P·M·G no modo edição. Cada widget declara os tiers que aceita — gráfico e calendário não descem para um terço. Layouts salvos com `half`/`full` seguem válidos (tradução na leitura, DTO aceita ambos).
- **Mural de notas** (#904): as notas ganham ordem (arrastar), podem ser **fixadas** no topo e passam a ser **arquivadas** em vez de excluídas — com "Desfazer" no toast e gaveta de arquivadas. Excluir definitivo só de dentro da gaveta.
- **Notas rápidas** (#886, #892): post-its pessoais com persistência real (`gdr_user_quick_notes`), alfinete 3D tonal e mural em papel quadrado; pendências concluíveis ganham check com saída animada.
- **Widgets vivos** (#893, #894, #896): Antonella vira consultora (cada insight com trilho de prioridade, tag e CTA próprio), Produção vira barra de progresso real (produzido ÷ planejado das OPs ativas) e os gráficos ganham área com gradiente, linha suave e tooltip do tema.

**Fora do Workspace**
- **Alerta anti-fraude de troca de dados bancários de fornecedor** (#864, #891): toda alteração de chave PIX/dados bancários deixa rastro em auditoria e o alerta aparece no sino — e na hora de pagar. Janela de 15 dias; primeiro preenchimento não alerta.
- **Chassis gravados pela marcadora** (#889, #890): tela de acompanhamento + guia de instalação.
- **Padrão de filtros clean em todas as listagens** (#881) e **Carteira de Pagáveis** mais direta (status "Pagar hoje", busca).
- **Deep-link `?due=`** (#885): o calendário abre a carteira já filtrada no vencimento do dia.

### Corrigido
- **KPI e gráfico de Faturamento passam a medir venda faturada** (#900): liam `/analytics/sales-cube`, que agrupa por mês de **criação** do pedido e inclui **rascunho e cancelado** — o "faturamento" da Home somava o que não foi faturado. Agora ambos usam `GET /workspace/revenue` (venda `INVOICED` por `invoicedAt`, um ponto por dia), com o mesmo número do Meu Dia.
- **Notas rápidas: "Nova nota" não fazia nada** (#888): `@MinLength(1)` rejeitava o post-it que nasce em branco e a mutação falhava em silêncio (400 sem `onError`). DTO passou a aceitar vazio e toda mutação ganhou toast de erro.

### Infra
- Migrations aditivas e idempotentes: `20260731120000_user_quick_notes`, `20260731210000_alert_supplier_banking_changed`, `20260801120000_quick_notes_board`.
- Histórico `_prisma_migrations` regularizado: a migration das notas rápidas fora aplicada à mão na rodada 6 sem registro — banco estava correto, o histórico é que mentia.

## [1.25.0] - 2026-07-31

### Adicionado
- **Workspace (Home por papel) — épico completo em produção** (#859, #860, #861, #862): registry de widgets + templates por perfil (RBAC v2), Resumo do Dia (Antonella V1) + Minhas Pendências + Agenda via módulo `workspace` na API (conteúdo curado por permissão no servidor), personalização persistida (`gdr_user_workspace_layouts` + modo edição com dnd-kit) e 6 widgets de domínio (fluxo 13 semanas, SLA CRM, carteira, fila WMS, docs veiculares, gargalos de capacidade).
- **Refinamento UX do Workspace** (#875): hierarquia visual em 3 níveis, grid denso com galeria "Adicionar widgets", Antonella analista (chip de status + CTA em pílula), agenda como calendário estilo Apple (Semana|Mês) e empty states padronizados.
- **Agenda: navegação e rollup executivo** (#882): navegação ‹ Hoje › por semana/mês na janela prospectiva de 42 dias, rollup por grupo com soma em dias densos ("18 pagamentos · R$ 132 mil") e popover de detalhe com total do dia.
- `GET /workspace/agenda?days=1..42` (#875) e campo `amount` estruturado no item financeiro da agenda (#880).

### Segurança/IAM
- Catálogo +5 permissões `workspace.*` (303→308) com grants em 17 perfis-raiz; curadoria por permissão fail-closed em todos os agregadores da Home.

### Infra
- Migration aditiva idempotente `20260730120000_user_workspace_layout` (aplicada via db execute + seed IAM).

## [1.24.0] - 2026-07-30

_Sem itens listados — edite antes de taggear._

## [1.23.0] - 2026-07-30

### Added
- feat: KPIs de carteira de clientes + indicadores de ciclo no CRM (#846) (#847)
- feat(production): liga etapas de roteiro a centros de trabalho (#815) (#836)

### Fixed
- fix(iam): reset de senha por admin revoga sessões do alvo + refresh nega troca pendente (#823) (#824)
- fix(iam): JwtStrategy consulta a denylist de sessão — revogação crítica derruba o access token (#835) (#837)
- fix(web): ícones do PWA com safe area — o A não estoura mais no Dock (#842)
- fix(web): tooltips dos gráficos legíveis no dark — tema compartilhado com itemStyle/labelStyle (#841)

### Changed
- style(web): Dark Sweep — 16 telas auditadas, 4 famílias de inconsistência corrigidas (#845)
- style(web): equivalência entre temas — física de luz no dark + símbolo pra fundo claro (#844)
- style(web): Consistency Pass — zero classes legadas + refinamentos finais (#840)
- style(web): follow-ups do De-box — status quiet, nomes legíveis, alertas agrupados (#839)
- style(web): De-box Pass — menos caixas, mais superfície (Fases 1-5 da auditoria) (#838)
- style(web): Premium Polish Pass — acabamento premium sem mudar layout/cores (#834)

## [1.22.0] - 2026-07-29

### Added
- feat(web): telas de auth com a identidade da landing (avecchi.ai) — backdrop oficial (mesh/glows), wordmark com o símbolo no A, card glass; copy "Bem-vindo de volta"; rota `/` vira redirect auth-aware (PRs #802/#803/#805)
- feat(web): login v2 100% marca — copy "Conectando pessoas, processos e resultados.", fundo vivo (linhas convergindo ao wordmark + pulsos SMIL + glow respirando 8s + parallax sutil), iluminação ambiente violeta/ciano e revelação do wordmark em loop de 12s (PRs #804/#808/#809/#811/#812)
- feat(web): shell interno rebrandado — wordmark Avecchi na sidebar (tone auto claro/escuro), versão real do produto no rodapé da sidebar (era v1.0 hardcoded), skeleton no menu durante o load de permissões (PRs #813/#825)
- feat(crm): Inbox WhatsApp com experiência do WhatsApp — papel de parede fixo com doodle industrial próprio, balões clássicos com ticks, 3 temas + automático (segue o tema do app), persistência por dispositivo (2 PRs + ajustes)
- feat(web): Soft Surfaces — linguagem visual premium: tokens de borda em alpha, sombras suaves em 2 camadas, tabelas sem grade (zebra ~3%, hover por tinta), inputs com glow de foco, botões com brilho interno, seleção da sidebar por tinta (PR do épico + fixes)

### Fixed
- fix(web): favicon da aba (Next 14 suprime icon.png com `metadata.icons` manual) + ícone quadrado e favicon.ico multi-size (#806)
- fix(web): modificador de opacidade em token var() não é gerado pelo Tailwind — bordas caíam no gray-200 do preflight (risco branco no dark); `borderColor/divideColor DEFAULT` agora herdam o token soft em todo o app

## [1.21.0] - 2026-07-28

### Added
- feat(crm): resumo IA da conversa no takeover — `POST /crm/leads/:id/summarize` (`claude-haiku-4-5`, prompt próprio), nota destacada `conversation_summary` na timeline com chips dos dados descobertos, custo em `SdrUsage`, botão "Resumir conversa" + disparo automático ao assumir a conversa; sem `ANTHROPIC_API_KEY` o botão some (#573 — PR #798)
- feat(crm): transcrição de áudio inbound do WhatsApp (F1 voz do SDR) — voice note do lead vira `[áudio transcrito] ...` na conversa e o SDR responde normalmente; STT OpenAI (`gpt-4o-mini-transcribe`, override `CRM_STT_MODEL`), fail-safe sem `OPENAI_API_KEY` (comportamento atual preservado), cap 20MB, gate de evals do prompt #525 aprovado (27/30, críticos 100%) (PR #797 — refs #506/#567)

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

[Unreleased]: https://github.com/adminadmin-AI/Avequi/compare/v1.44.0...HEAD
[1.44.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.43.0...v1.44.0
[1.43.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.42.0...v1.43.0
[1.42.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.41.1...v1.42.0
[1.41.1]: https://github.com/adminadmin-AI/Avequi/compare/v1.41.0...v1.41.1
[1.41.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.40.0...v1.41.0
[1.40.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.39.0...v1.40.0
[1.39.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.38.0...v1.39.0
[1.38.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.37.0...v1.38.0
[1.37.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.36.0...v1.37.0
[1.36.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.35.0...v1.36.0
[1.35.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.34.0...v1.35.0
[1.34.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.33.0...v1.34.0
[1.33.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.32.0...v1.33.0
[1.32.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.31.0...v1.32.0
[1.31.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.30.1...v1.31.0
[1.30.1]: https://github.com/adminadmin-AI/Avequi/compare/v1.30.0...v1.30.1
[1.30.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.29.1...v1.30.0
[1.29.1]: https://github.com/adminadmin-AI/Avequi/compare/v1.29.0...v1.29.1
[1.29.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.28.0...v1.29.0
[1.28.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.27.0...v1.28.0
[1.27.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.26.0...v1.27.0
[1.26.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.25.0...v1.26.0
[1.25.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.24.0...v1.25.0
[1.24.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.23.0...v1.24.0
[1.23.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.22.0...v1.23.0
[1.22.0]: https://github.com/adminadmin-AI/Avequi/compare/v1.21.0...v1.22.0
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
