# Setup do Claude Code — Time Avequi ERP

Procedimento completo do zero: da instalação do Claude Code até o projeto rodando com todos os agentes.

---

## PRE-REQUISITO: Conta Anthropic

Voce precisa de uma conta em **claude.ai** com acesso ao **Claude Code** (plano Pro ou Team).

---

## 1. Instalar Node.js

Acesse **nodejs.org** e baixe a versao LTS (20 ou superior).

Verifique:
```bash
node --version   # deve mostrar v20+
npm --version    # deve mostrar 10+
```

---

## 2. Instalar o Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

Verifique:
```bash
claude --version
```

---

## 3. Autenticar no Claude Code

```bash
claude
```

Na primeira execucao abre o browser para login com sua conta Anthropic. Faca login e autorize.

---

## 4. Instalar o Git (se nao tiver)

**Mac:**
```bash
xcode-select --install
```

**Windows:** baixe em **git-scm.com**

**Linux:**
```bash
sudo apt install git
```

---

## 5. Instalar GitHub CLI (gh)

Necessario para interagir com issues, PRs e o project board.

**Mac:**
```bash
brew install gh
```

**Windows:**
```bash
winget install GitHub.cli
```

**Linux:**
```bash
sudo apt install gh
```

Depois autentique:
```bash
gh auth login
# Escolher: GitHub.com → HTTPS → Login with a web browser
```

---

## 6. Clonar o repositorio

```bash
gh repo clone adminadmin-AI/Avequi
cd Avequi
```

> Se `gh` nao funcionar, use: `git clone https://github.com/adminadmin-AI/Avequi.git`
> (vai pedir token de acesso — gere em github.com/settings/tokens com escopo `repo`)

---

## 7. Instalar dependencias do projeto

```bash
npm install
```

---

## 8. Configurar variaveis de ambiente

```bash
cp .env.example .env
```

Preencha o `.env` com as credenciais reais — peca ao responsavel do projeto:
- `DATABASE_URL` — Supabase pooler (porta 6543)
- `DIRECT_URL` — Supabase direct (porta 5432)
- `JWT_SECRET` (minimo 32 caracteres)
- `JWT_REFRESH_SECRET`
- `REDIS_URL`
- `FOCUS_NFE_TOKEN`
- `WEB_URL` (default: http://localhost:3000)

---

## 9. Instalar os agentes GSD

O GSD e o framework central de agentes. Instala 33 agentes, 66 skills e hooks automaticos em `~/.claude/`.

```bash
npx get-shit-done-cc@1.40.0
```

Aguarde concluir.

---

## 10. Instalar os squads do repositorio

Os squads ja vem no repositorio em `.claude/commands/`. Copie para o diretorio global do Claude Code:

```bash
cp -r .claude/commands/* ~/.claude/commands/
```

Isso instala **20 squads** com 507 arquivos de agentes especializados.

> **IMPORTANTE:** Nao precisa mais clonar o `xquads-squads` separado — tudo ja esta no repo.

---

## 11. Instalar plugins do Claude Code

### Vercel (obrigatorio para frontend/deploy)

```bash
claude mcp add-from-claude-app vercel -- vercel
```

> Se pedir autenticacao Vercel, siga o fluxo no browser.

### Google Drive (opcional)

```bash
claude mcp add-from-claude-app "Google Drive" -- google-drive
```

---

## 12. Gerar cliente Prisma

```bash
cd apps/api
npx prisma generate
cd ../..
```

---

## 13. Abrir o projeto no Claude Code

```bash
claude
```

O Claude carrega o contexto do projeto automaticamente via `CLAUDE.md`.

---

## Verificacao final

Dentro do Claude Code, com o projeto aberto, teste:

1. `/gsd-help` → lista todos os comandos GSD
2. `/erp-squad` → mostra o time de ERP especialista
3. `/gsd-health` → verifica saude do setup
4. `/cybersecurity` → mostra o time de seguranca

Se os quatro funcionarem, o setup esta completo.

---

## Resumo — tudo em sequencia

```bash
# 1. Instalar ferramentas
npm install -g @anthropic-ai/claude-code
# Mac: brew install gh  |  Windows: winget install GitHub.cli
gh auth login

# 2. Clonar o projeto
gh repo clone adminadmin-AI/Avequi
cd Avequi

# 3. Instalar dependencias
npm install

# 4. Configurar .env
cp .env.example .env
# → preencher manualmente com as credenciais

# 5. Gerar cliente Prisma
cd apps/api && npx prisma generate && cd ../..

# 6. Instalar agentes GSD
npx get-shit-done-cc@1.40.0

# 7. Instalar squads (ja vem no repo)
cp -r .claude/commands/* ~/.claude/commands/

# 8. Instalar plugins
claude mcp add-from-claude-app vercel -- vercel

# 9. Abrir o projeto
claude
```

---

## Squads disponiveis (20 squads, 507 arquivos)

### Squads criticos para o projeto

| Comando | Descricao | Uso principal |
|---------|-----------|---------------|
| `/erp-squad` | NestJS, MRP, regras ERP, Fiscal/NFe | Modulos de dominio do ERP |
| `/synapse` | Gestao de regras de dominio e comandos | Criar/editar regras de negocio |
| `/finance-squad` | Modelagem financeira, CFO virtual | Modulo financeiro |
| `/cybersecurity` | Pentest, auditoria de seguranca | Auditorias, vulnerabilidades |
| `/AIOX` | Framework de gestao de projeto com IA | Planejamento, sprints |

### Squads GSD (framework de execucao)

| Comando | Descricao |
|---------|-----------|
| `/gsd-plan-phase` | Planejar nova fase ou modulo |
| `/gsd-execute-phase` | Executar plano com commits atomicos |
| `/gsd-code-review` | Revisar codigo antes de PR |
| `/gsd-debug` | Debug com metodo cientifico |
| `/gsd-secure-phase` | Verificar mitigacoes de seguranca |
| `/gsd-new-project` | Criar roadmap de novo milestone |
| `/gsd-add-tests` | Adicionar testes automatizados |
| `/gsd-help` | Lista todos os comandos GSD |
| `/gsd-health` | Verifica saude do setup |

### Squads de estrategia e negocios

| Comando | Descricao |
|---------|-----------|
| `/advisory-board` | Conselho estrategico (Naval, Munger, Reid...) |
| `/c-level-squad` | C-suite virtual (CTO, CMO, COO...) |
| `/hormozi-squad` | Ofertas, leads, precificacao (metodo Hormozi) |
| `/brand-squad` | Branding, posicionamento, naming |
| `/storytelling` | Narrativa, pitch, apresentacoes |
| `/data-squad` | Growth, retencao, analytics |

### Squads de conteudo e design

| Comando | Descricao |
|---------|-----------|
| `/copy-squad` | Copywriting (Halbert, Ogilvy, Schwartz...) |
| `/copy-master` | Copy avancado (VSL, sales letters, funnels) |
| `/design-squad` | UX/UI design (Dan Mall, Brad Frost...) |
| `/design-system` | Atomic design, componentes |
| `/traffic-masters` | Trafego pago, ads, performance |
| `/movement` | Movimentos culturais, manifestos |
| `/claude-code-mastery` | Otimizacao do Claude Code |

---

## Duvidas?

Fale com **@adminadmin-AI** no GitHub ou abra uma issue em https://github.com/adminadmin-AI/Avequi.
