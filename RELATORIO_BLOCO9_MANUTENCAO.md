# Relatório — Bloco 9 (Manutenção) e o que aconteceu no Git

> Documento explicando, **passo a passo e em linguagem simples**, tudo o que foi feito
> no Git durante a entrega do Bloco 9 do frontend (telas #133, #134 e #135).
> Data: 25/06/2026 · Autor das mudanças: Rafael (com Claude Code).

---

## 1. O que é cada coisa (glossário rápido para leigos)

- **Repositório (repo):** a "pasta na nuvem" (no GitHub) onde mora todo o código do projeto.
- **`main`:** a versão **oficial** do código — a que vale. Nunca mexemos direto nela.
- **Branch (ramo):** uma **cópia paralela** do código onde trabalhamos sem bagunçar a `main`.
  Quando termina e está aprovado, ela é "juntada" de volta na `main`.
- **Commit:** um **"save"** do trabalho, com uma mensagem explicando o que mudou.
- **Push:** **enviar** os commits do seu computador para o GitHub.
- **PR (Pull Request):** um **pedido de revisão** — "olha o que fiz nesta branch, posso juntar na main?".
  É onde se descreve a mudança e se discute antes de aprovar.
- **Squash merge:** juntar a branch na `main` **transformando todos os commits dela em um só**,
  deixando o histórico limpo (1 PR = 1 linha no histórico).
- **Issue:** uma **tarefa**/pedido registrado no GitHub (ex.: "fazer a tela X"). Tem um número (#133).
- **Fechar a issue:** marcar a tarefa como **concluída**.

**A regra de ouro que seguimos:** nunca commitar direto na `main`. Sempre
`branch` → `commit` → `push` → `PR` → `merge`. Isso mantém a `main` sempre estável.

---

## 2. Visão geral do que foi entregue

O **Bloco 9 — Manutenção** tinha 3 tarefas. Todas foram concluídas, cada uma com
sua própria branch, PR e merge:

| Issue | Tela | PR | Resultado |
|------|------|-----|-----------|
| **#133** | Ordens de Manutenção (`/app/maintenance`) | [#279](https://github.com/adminadmin-AI/Avequi/pull/279) | ✅ Mergeado e issue fechada |
| **#134** | Calendário de Manutenção Preventiva | [#280](https://github.com/adminadmin-AI/Avequi/pull/280) | ✅ Mergeado e issue fechada |
| **#135** | Centros de Trabalho (`/app/production/work-centers`) | [#281](https://github.com/adminadmin-AI/Avequi/pull/281) | ✅ Mergeado e issue fechada |

Antes de programar **cada** tela, o backend real foi inspecionado (controllers,
DTOs, enums do banco). Isso é importante porque o **texto das issues costuma divergir
do que o backend realmente faz** — e a gente sempre implementa a versão fiel ao backend,
documentando as diferenças.

---

## 3. Passo a passo de cada tarefa no Git

### 🟦 #133 — Ordens de Manutenção (PR #279)

1. Saímos da `main` atualizada e criamos a branch **`feat/maintenance-orders-133`**.
2. Criamos a tela `/app/maintenance` (abas "Ordens" e "Equipamentos"), o arquivo de
   tipos e o helper de status.
3. Rodamos `npx tsc --noEmit` (checagem de tipos do TypeScript) — **passou** (sem erros).
4. **Commit** com mensagem detalhada explicando o que entrou e as divergências em
   relação à issue (endpoints reais, status `OPEN`, etc.).
5. **Push** da branch para o GitHub.
6. Abrimos o **PR #279** com descrição didática + comentário-resumo.
7. **Squash merge** na `main` e a branch foi apagada automaticamente.
8. A issue **#133 foi fechada** referenciando o PR.
9. Voltamos para a `main` e sincronizamos (`git pull`).

**Diferenças da issue x backend (decisões honestas):** os endpoints reais são
`/maintenance/orders` (iniciar/concluir/cancelar via **PATCH**, não POST); o status
inicial é **OPEN** (a issue dizia "PLANNED", que não existe); concluir grava
**resolução + custo** (não "horas trabalhadas", que não existe); "peças necessárias"
não existe no backend e foi omitido. Como uma ordem precisa de um equipamento, incluímos
a aba **Equipamentos** (o backend já tinha esse CRUD pronto).

### 🟩 #134 — Calendário de Manutenção Preventiva (PR #280)

1. Criamos a branch **`feat/maintenance-calendar-134`** a partir da `main`.
2. Adicionamos um **calendário mensal** (feito em CSS puro, sem bibliotecas) com um
   botão para alternar entre **Tabela** e **Calendário** na tela de Manutenção.
   Cada manutenção agendada vira uma "bolinha" colorida no dia; clicar abre um
   detalhe da ordem.
3. `npx tsc --noEmit` — **passou**.
4. **Commit** → **push** → **PR #280** (com comentário-resumo) → **squash merge** →
   issue **#134 fechada** → `main` sincronizada.

### 🟪 #135 — Centros de Trabalho (PR #281) — aqui corrigimos uma duplicação

Esta tarefa era especial: descobrimos que ela estava **duplicada**.

- **O problema:** a issue #135 pedia uma tela de "Centros de Trabalho", mas o **#125**
  (Roteiros) **já tinha feito exatamente esse CRUD**, escondido como uma **aba**.
- **Importante:** a duplicação era **só de tela (frontend)**. O backend é **único**
  (`/capacity/work-centers`) — não havia duplicação de backend nem de planejamento de banco.
  A origem foi o **planejamento das issues**, que listou o mesmo recurso duas vezes.
- **A correção (consolidar):** em vez de ficar com duas telas para a mesma coisa,
  criamos a **página dedicada** que o #135 pedia e **removemos a aba duplicada** de Roteiros.

Passos no Git:
1. Branch **`feat/work-centers-135`**.
2. Criamos `/app/production/work-centers` (com KPIs, descrição e coluna **Status**),
   adicionamos o item na barra lateral e **removemos a aba** de `/app/production/routing`
   (que voltou a ser só "Roteiros").
3. `npx tsc --noEmit` — **passou**.
4. **Commit** → **push** → **PR #281** → **squash merge** → issue **#135 fechada** →
   `main` sincronizada.

Nenhuma funcionalidade foi perdida: tudo o que a aba fazia foi para a nova página, com melhorias.

---

## 4. Como ficou o histórico da `main` (do mais novo para o mais antigo)

```
1fad338  feat(web): Centros de Trabalho /app/production/work-centers (#135) (#281)
cd1b55e  feat(web): Calendário de Manutenção Preventiva (#134) (#280)
1d57c75  feat(web): Ordens de Manutenção /app/maintenance (#133) (#279)
393e1b6  feat(web): Dashboard de Qualidade /app/quality (#132) (#278)   <- estado anterior
```

Cada linha acima é **um PR inteiro** virando **um único commit** na `main` (efeito do squash merge).

---

## 5. Garantias de qualidade aplicadas em todas as tarefas

- ✅ **Nunca** commitamos direto na `main` — sempre branch + PR.
- ✅ **Checagem de tipos** (`npx tsc --noEmit`) passou antes de cada commit.
- ✅ Backend **inspecionado** antes de programar (não confiamos no texto da issue).
- ✅ Divergências documentadas no PR (transparência: nada de "fingir" recurso inexistente).
- ✅ PRs e commits **bem descritos** (a ponto de um leigo entender).
- ✅ Issues fechadas e `main` sincronizada ao fim de cada uma.

---

## 6. O que vem depois

Bloco 9 concluído. Próximos da maratona de telas:
- **Bloco 10 — Analytics** (#136–#138)
- **Bloco FC — Transversais** (#139–#142) — fim da maratona.

Dependências de backend continuam rastreadas na **issue #247**.
