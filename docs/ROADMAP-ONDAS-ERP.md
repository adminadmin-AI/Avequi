# Roadmap das Ondas do ERP Avequi

## LEIA ISTO PRIMEIRO — PESSOAS E AGENTES DE IA

- Este arquivo é o **índice canônico da divisão do desenvolvimento e da implantação do ERP por Ondas**. Para qualquer pergunta sobre *sequência, escopo, dependências, gates ou estado* de uma Onda, leia este arquivo **antes** de issues, PRs ou outros documentos.
- Ele é um **mapa**, não um relatório técnico: aponta para as issues, PRs e documentos onde vive o detalhe.
- **Ausência de evidência não autoriza inferência.** Cada afirmação aqui tem um grau de confiança: **CONFIRMADO** (documento ou decisão explícita neste repositório), **PARCIAL** (parte da definição encontrada), **INFERIDO** (parece corresponder, mas não há definição explícita suficiente) ou **A CONFIRMAR** (não há evidência para virar regra). Itens não confirmados aparecem explicitamente como **A CONFIRMAR COM RAFAEL/CLAUDIO**.
- **Onda ≠ Fase ≠ Bloco.** Este repositório usa várias taxonomias que **não** são as Ondas (ver §3). Não converta uma na outra sem evidência explícita de equivalência.
- Origem da divisão por Ondas: o **Plano Mestre de Implantação** do ERP, mantido por Rafael **fora deste repositório** (camada de coordenação privada). Este arquivo é a projeção pública e verificável daquele plano; onde o Plano Mestre não está refletido em evidência **aqui**, o item fica **A CONFIRMAR**.
- Este repositório deve ser tratado como **público**: nenhum segredo, credencial, dado pessoal ou detalhe operacional sensível entra neste roadmap. Evidências operacionais não públicas são referenciadas de forma abstrata.
- Manutenção: quem fechar ou abrir uma Onda, ou receber uma definição nova de Rafael/Claudio, atualiza **este arquivo na mesma PR** (ou numa PR documental própria) e registra a evidência.

**Última verificação do estado:** 09/09/2026 (main `aca27c9`, release v1.53.2 publicada 09/09 22:39 UTC, `/api/version` = 1.53.2 em produção).

---

## 1. Visão geral (1 minuto)

| Onda | Objetivo | Status | Depende de | Próximo marco |
|---|---|---|---|---|
| **Onda 0** — pré-condições de produção (frente IAM/segurança neste repo) | O ERP em produção com autenticação, sessões, seed e credenciais em estado seguro antes de qualquer go-live operacional | **Frente IAM tecnicamente encerrada no código** (09/09/2026, v1.53.2). O Gate Global da Onda 0 tem itens operacionais fora deste repositório: **A CONFIRMAR** | — | Gate Global declarado por Rafael/Claudio (**A CONFIRMAR**) |
| **Ondas 1, 2 e 3** | **A CONFIRMAR COM RAFAEL/CLAUDIO** — não há definição neste repositório | Sem evidência | — | Registrar a definição aqui |
| **Onda 4A** — corte da emissão fiscal (NF-e) no ERP | A empresa passa a **emitir NF-e pelo ERP** em vez do emissor anterior, com série/numeração contínuas e hypercare | **Não iniciada como corte**; capacidades técnicas de emissão já existem e a CRD emitiu notas reais em 08/2026; a GDR ainda não | Decisões de série/numeração e token de produção (contador + Claudio), estoque de abertura, base de clientes (#1100, #954) | Corte da emissão (data **A CONFIRMAR**) → 14 dias de hypercare → 30 dias de acompanhamento |
| **Onda 4B** | **A CONFIRMAR** — só se sabe que vem **depois** da 4A e que o backfill histórico de NF-e precisa estar concluído antes dela | Sem definição | Onda 4A + backfill (#1134) | — |
| **Ondas 5 em diante** | **A CONFIRMAR COM RAFAEL/CLAUDIO** | Sem evidência | — | — |

Sequência conhecida com evidência: **Onda 0 → … → Onda 4A → Onda 4B**. As Ondas intermediárias e posteriores existem no Plano Mestre, mas **não estão definidas neste repositório**.

---

## 2. Matriz de evidência (o que sustenta cada linha)

| Onda | Definição encontrada neste repositório | Evidência | Confiança |
|---|---|---|---|
| Onda 0 | "Onda 0 / IAM" nomeia a frente de higiene de autenticação, sessões, seed e credenciais executada em 09/2026 | PR #1151 (título e corpo: "Onda 0 / IAM — higiene do seed"), cabeçalhos de `apps/api/prisma/seeds/*.ts` e specs em `apps/api/src/prisma/seeds/`, PR #1160 (corpo: "Onda 0 / IAM — último resíduo da trilha #1142 → #1143 → #1149 → #1151"), CHANGELOG v1.52.0 e v1.53.2 | **CONFIRMADO** (frente IAM) |
| Onda 0 — Gate Global | Menção a um "Gate Global" da Onda 0 aparece apenas em comunicação fora deste repositório | Nenhum documento, issue ou PR deste repositório define o Gate Global | **A CONFIRMAR** |
| Ondas 1–3 | Nenhuma | Busca por `Onda 1/2/3`, `Wave`, `Plano Mestre`, `roadmap` em docs, issues e PRs: nenhum resultado com esse significado | **A CONFIRMAR** |
| Onda 4A | "Frente do emissor fiscal": corte da emissão de NF-e para o ERP; série/numeração decididas com contador + Claudio + Focus/SEFAZ; último número real obtido no D-1; 14 dias de hypercare como gate mínimo para outro go-live; 30 dias de acompanhamento até o DONE final | `docs/fiscal/importacao-nfe-emitida-xml.md` (§ "Princípio central", "Numeração", "Relação com a Onda 4A"); PR #1134 (§ "Relação com a Onda 4A") | **CONFIRMADO** (papel e gates) / **PARCIAL** (escopo completo e data) |
| Onda 4A — checklist operacional do go-live da GDR | Issues de go-live do faturamento da GDR no ERP tratam exatamente do que a 4A precisa (numeração, estoque de abertura, clientes, certificado, token de produção) | #1100, #954 (nenhuma delas usa a palavra "Onda") | **INFERIDO** — equivalência com a 4A a confirmar |
| Onda 4B | Existe e vem depois da 4A; o backfill de NF-e emitidas deve terminar "até 30 dias após o corte da 4A e obrigatoriamente antes da 4B" | `docs/fiscal/importacao-nfe-emitida-xml.md`; PR #1134 | **PARCIAL** (só a posição na sequência) |
| Ondas 5+ | Nenhuma | — | **A CONFIRMAR** |

---

## 3. O que NÃO é uma Onda (taxonomias paralelas deste repositório)

Para não confundir quem chega pelo GitHub:

| Nome | Onde aparece | O que é |
|---|---|---|
| **Fases 1–4 (Core, Fábrica, Logística, Inteligência)** | `docs/PRD.md` §8, milestones do GitHub, campo *Fase* do Project #7, labels `fase-1`…`fase-4` | Fases de **construção** do produto por sprints (2025–2026). Fases 1–3 concluídas no backend; Fase 4 é frontend/inteligência |
| **Fases 0–7 (#155–#203)** | `CLAUDE.md` § "Roadmap ativo" | Roadmap de **maturidade/segurança** em issues (Fase 0 segurança concluída; Fiscal, Financeiro, E2E, Produção, Comercial, Fiscal complementar, Maturidade) |
| **Milestones F0–F10 / F-CROSS (#79–#142)** | `docs/PRD.md` §8 "Fase 4 — Frontend" | Marcos do **frontend** |
| **Blocos A–G e Fases M0–M7 do IAM** | `docs/iam/ARQUITETURA-IAM-V2.md`, `docs/iam/IAM.md`, issues #334–#354 | Plano de **arquitetura de segurança** (RBAC v2, sessões, auditoria, MFA, multi-tenant, frontend) |
| **F1–F4 do fiscal (Notas de Débito/Crédito)** | PRs #762, #772, #773, #775; `docs/faturamento/auditoria-homologacao-notas-debito-credito-2026-07-17.md` ("onda F4") | Fases internas do épico #753. **Não** são as Ondas 4A/4B |
| **"Ondas 1–4 da escrita humana"** | Épico #987, PRs #988, #995, #996, #997, `apps/web/src/lib/voice-lint` | Lotes de reescrita de UX writing. Nome coincidente, significado diferente |
| **"Onda 2 do hardening"** | PR #1038 | Lote de correções de segurança. Idem |
| **Frente** (campo do Project #7) | Board | Agrupamento por **domínio/tema** (IAM, Fiscal & Faturamento, RENAVE, Produção & MRP…). Uma Onda pode atravessar várias Frentes |

---

## 4. Onda 0 — pré-condições de produção (frente IAM/segurança)

- **Objetivo de negócio:** garantir que o ERP já em produção esteja seguro e sob controle antes de qualquer go-live operacional: quem entra, como entra, o que o seed pode criar, e nenhuma credencial exposta. **CONFIRMADO** para a frente IAM; o objetivo completo da Onda 0 (Gate Global) é **A CONFIRMAR**.
- **Por que existe:** em 02/09/2026 um incidente de credencial (senha administrativa de desenvolvimento em documentos do repositório público) e um bug na troca de senha por cookie httpOnly mostraram que a base de autenticação precisava ser fechada antes de avançar. A trilha de correção foi nomeada "Onda 0 / IAM".
- **Escopo confirmado (o que entrou):**
  - troca voluntária de senha reconhecendo a sessão por cookie httpOnly (#1142 → PR #1143);
  - validação de sessão do change-password igual à da `JwtStrategy` e CSRF só isentando Bearer válido (#1144, #1145 → PR #1149);
  - remoção de credencial literal dos documentos (PR #1148);
  - seed estrutural separado do seed demo, demo bloqueado fora de desenvolvimento local e sem identidade real (PR #1151);
  - troca de senha atômica no Postgres: histórico, revogação de sessões e de todos os refresh tokens, eventos de segurança e telemetria fiel, Redis pós-commit (#1146 → PR #1160).
- **Fora de escopo (por decisão registrada nas PRs/issues):** Fase C do RBAC (#948), Fase D / aposentar `User.role` (#1006), serialização da troca de senha por usuário (#1161), reuso da senha atual com histórico vazio (#1162), rotação de segredos e RLS efetiva (#60). Nenhum desses foi "puxado" para a Onda 0.
- **Dependências:** nenhuma dentro do código. Operacionalmente depende de decisões fora deste repositório (usuários nominais, backup, monitoramento) — **A CONFIRMAR**.
- **Gate de entrada:** ERP já em produção (v1.51.x) — **CONFIRMADO** pelo histórico de releases.
- **Gate de saída:** para a frente IAM, todas as PRs mescladas, auditadas de forma independente e publicadas — **CONFIRMADO**. Para a Onda 0 como um todo, o "Gate Global" (itens 1–12 citados no Plano Mestre) **não está documentado aqui** — **A CONFIRMAR COM RAFAEL/CLAUDIO**.
- **Status atual (09/09/2026):** **frente IAM tecnicamente encerrada no desenvolvimento** e **em produção na v1.53.2** (publicada 09/09 22:39 UTC). Isso **não** significa que o domínio IAM está concluído: #948, #1006, #1011, #1016, #780 e #1161/#1162 seguem abertos como evolução posterior.
- **Já concluído:** #1142, #1144, #1145, #1146 fechadas; PRs #1143, #1148, #1149, #1151, #1160 mescladas; releases v1.51.1, v1.51.2, v1.52.0 (inclui #1151) e v1.53.2 (inclui #1160).
- **Falta concluir:** dentro deste repositório, nada da frente IAM. Fora dele, o encerramento formal do Gate Global — **A CONFIRMAR**.
- **Riscos relevantes:** dívidas herdadas registradas em #1161 (duas trocas concorrentes, replay do token restrito no mesmo segundo, sessão criada durante a troca) e #1162 (reuso da senha atual na primeira troca). Ambas **não bloqueiam** a Onda 0 por decisão de Rafael (09/09/2026, registrada na PR #1160).
- **Issues principais:** #1142, #1144, #1145, #1146 (fechadas); #1161, #1162 (abertas, posteriores).
- **PRs principais:** #1143, #1148, #1149, #1151, #1160.
- **Documentos técnicos:** `docs/iam/IAM.md`, `docs/iam/ARQUITETURA-IAM-V2.md`, `docs/ONBOARDING.md` (§3, seeds), `apps/api/prisma/seeds/seed-guard.ts` (política dos seeds), auditorias Codex nos comentários da PR #1160.
- **Última evidência verificada:** 09/09/2026 — main `aca27c9`, v1.53.2 em produção, #1146 fechada, #1161/#1162 abertas.
- **Pontos A CONFIRMAR:** (1) composição exata do Gate Global da Onda 0 e quem declara o encerramento; (2) se existem outras frentes da Onda 0 além da IAM (por exemplo backup, monitoramento, usuários nominais) que devam ser rastreadas por issue neste repositório.

---

## 5. Ondas 1, 2 e 3 — A CONFIRMAR COM RAFAEL/CLAUDIO

Não existe, neste repositório, nenhuma definição, issue, PR ou documento que descreva o objetivo, o escopo ou o estado das Ondas 1, 2 e 3. Elas constam do Plano Mestre mantido fora daqui. **Nada deve ser inferido** a partir de módulos ou Frentes existentes (Estoque, Compras, Produção, Financeiro etc.): a correspondência entre módulo e Onda só entra neste arquivo quando Rafael/Claudio a registrarem.

Perguntas em aberto: quais são as Ondas 1–3, qual o objetivo de cada uma, qual a ordem em relação à 4A, e quais issues/épicos deste repositório pertencem a cada uma.

---

## 6. Onda 4A — corte da emissão fiscal (NF-e) no ERP

- **Objetivo de negócio:** as empresas passam a **emitir as NF-e de venda pelo ERP** (via Focus NFe) em vez do emissor anterior, com continuidade fiscal (série, numeração, situação na SEFAZ) e sem quebra de sequência. **CONFIRMADO** (`docs/fiscal/importacao-nfe-emitida-xml.md`, PR #1134).
- **Por que existe:** o ERP tem o histórico de notas emitidas apenas até 13/06/2026 (reidratação, `docs/fiscal/reidratacao-historico.md`); desde então a emissão continua no emissor anterior. Enquanto o corte não acontece, o faturamento no ERP não gera receita no financeiro (#1100).
- **Escopo confirmado:**
  - decisão de **série e numeração** (continuar a sequência ou inutilizar faixa) e obtenção do **último número real no D-1** do corte — decidido com **contador + Claudio + Focus/SEFAZ**;
  - **corte da emissão** propriamente dito (a partir de uma data, toda NF-e nova sai do ERP);
  - **hypercare de 14 dias** após o corte, definido como **gate mínimo para qualquer outro go-live**;
  - **30 dias de acompanhamento** até o DONE final da Onda.
- **O que NÃO é a 4A (distinção obrigatória):**
  - **CUTOVER DA EMISSÃO ≠ BACKFILL HISTÓRICO.** O backfill das NF-e emitidas pelo emissor anterior (importador canônico, PR #1134, `docs/fiscal/importacao-nfe-emitida-xml.md`) **não é blocker funcional do corte**: nenhum caminho da emissão consulta o histórico importado para numerar. O backfill tem prazo próprio: **até 30 dias após o corte da 4A e obrigatoriamente antes da 4B**. Ele não altera os 14 dias de hypercare nem os 30 de acompanhamento.
  - As fases **F1–F4 das Notas de Débito/Crédito** (épico #753) são outra coisa (ver §3).
- **Capacidades técnicas já existentes (não confundir com "Onda iniciada"):** emissão de NF-e/NFC-e via Focus com webhook, validador, DANFE, cancelamento e reemissão, fatura/duplicatas, devolução, notas de débito/crédito, homologação SEFAZ documentada (`docs/faturamento/*`). A **CRD** já emitiu NF-e reais pelo ERP em 08/2026 (#954: notas 20002–20005; faixa 14517–19999 inutilizada). A **GDR** ainda não emitiu nenhuma pelo ERP (#1100, medição de 18/08/2026).
- **Dependências (INFERIDO a partir de #1100 e #954, que não usam o termo "Onda"):** série/último número da GDR (contador), token Focus de produção da GDR (Claudio), certificado A1 válido, estoque de abertura carregado, base de clientes importada e validada para NF-e, ensaio ponta a ponta em homologação (pedido → reserva → separação → conferência → NF-e → título a receber), cadastro de chassis/`tracksSerial` (#494) para o fluxo com veículo.
- **Gate de entrada:** decisões de série/numeração e token de produção tomadas; checklist operacional do go-live cumprido (#1100 e #954 abertas) — **INFERIDO**.
- **Gate de saída:** 14 dias de hypercare sem regressão (gate mínimo) e 30 dias de acompanhamento (DONE) — **CONFIRMADO**.
- **Status atual (09/09/2026):** **corte não realizado**. #1100 ("Go-live do faturamento — GDR, 01/09/2026") continua **aberta** com bloqueadores em aberto (numeração, estoque de abertura, base de clientes); #954 (ativação fiscal da GDR por tenant) **aberta**. A data de 01/09 citada na #1100 **não se concretizou**; a nova data é **A CONFIRMAR**.
- **Já concluído:** capacidades de emissão e homologação; importador canônico de NF-e emitidas mesclado (PR #1134, v1.49.x) **sem dry-run nem commit em produção**; ativação por tenant validada na CRD.
- **Falta concluir:** decisões de série/numeração e token da GDR; carga de estoque de abertura e clientes; ensaio ponta a ponta; corte; hypercare; acompanhamento; backfill dentro do prazo.
- **Riscos relevantes:** colisão de numeração se o ERP emitir número já usado pelo emissor anterior (risco da decisão de série, não do backfill); NF-e emitidas sem grupo IBS/CBS após 03/08/2026 (decisão do contador); motor não calcula ST (#1082); Simples Nacional/CSOSN (#1068, #1075); contingência SVC nunca exercitada (#954).
- **Issues principais:** #1100, #954 (abertas); #1082, #1068, #1075, #1080 (fiscais abertas, relevância a confirmar); #483 (go-live 03/08 da CRD, fechada); #1152 (fatura/duplicatas, fechada).
- **PRs principais:** #1134 (importador de emitidas), #1153/#1155/#1157 (fatura/duplicatas, cancelar e reemitir, reissue transacional — v1.52.0 a v1.53.1), #1159 (script de venda + NF-e assistida fora da API, **não executado**).
- **Documentos técnicos:** `docs/fiscal/importacao-nfe-emitida-xml.md`, `docs/fiscal/reidratacao-historico.md`, `docs/fiscal/importacao-nfe-recebida-xml.md`, `docs/faturamento/revisao-cadastros-golive-0308.md`, `docs/faturamento/runbook-homologacao-usinagem-ja.md`, `docs/faturamento/homologacao-simples-nacional-2026-08-19.md`.
- **Última evidência verificada:** 09/09/2026 — #1100 e #954 abertas; v1.53.2 em produção; nenhum registro de corte.
- **Pontos A CONFIRMAR:** (1) data-alvo do corte; (2) se o corte é por empresa (GDR e CRD separadamente) ou único; (3) se #1100/#954 são formalmente "a Onda 4A" e devem ganhar essa marcação; (4) o que exatamente compõe o escopo além da emissão (ex.: financeiro a receber, RENAVE/ATPV-e #527 entram na 4A ou depois?).

---

## 7. Onda 4B — A CONFIRMAR

Único fato sustentado por documento: a Onda 4B vem **depois** da 4A, e o **backfill histórico de NF-e emitidas** (PR #1134) precisa estar concluído **antes** dela (`docs/fiscal/importacao-nfe-emitida-xml.md`, § "Relação com a Onda 4A"). Objetivo, escopo, gates e estado da 4B **não estão definidos neste repositório** — **A CONFIRMAR COM RAFAEL/CLAUDIO**.

---

## 8. Ondas 5 em diante — A CONFIRMAR

Sem qualquer evidência neste repositório.

---

## 9. Como usar e manter este arquivo

- **Pergunta sobre Onda?** Comece pela tabela da §1; desça para a seção da Onda; siga os links para issues/PRs/docs. Se a resposta estiver marcada **A CONFIRMAR**, a resposta correta é "não está definido; confirmar com Rafael/Claudio" — nunca uma inferência.
- **Nova definição recebida de Rafael/Claudio?** Registre aqui com a fonte (issue, PR, comentário, documento), promova a confiança e, se for decisão de governança, abra/atualize a issue correspondente.
- **Fechou ou abriu uma Onda?** Atualize a §1, a seção da Onda e a linha "Última verificação do estado" na mesma PR.
- **Não coloque aqui:** segredos, credenciais, dados pessoais, detalhes de contas de usuários, dumps, caminhos locais, detalhes operacionais de produção que não precisem ser públicos, informações comerciais/financeiras confidenciais.
- Governança de merge, release e deploy: ver `CONTRIBUTING.md` e `docs/VERSIONING.md`. Este arquivo não autoriza nada por si só.
