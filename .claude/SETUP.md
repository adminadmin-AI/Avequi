# Setup do Claude Code — Time Avequi ERP

Procedimento completo do zero: da instalação do Claude Code até o projeto rodando com todos os agentes.

---

## PRÉ-REQUISITO: Conta Anthropic

Você precisa de uma conta em **claude.ai** com acesso ao **Claude Code** (plano Pro ou Team).

---

## 1. Instalar Node.js

Acesse **nodejs.org** e baixe a versão LTS (20 ou superior).

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

Na primeira execução abre o browser para login com sua conta Anthropic. Faça login e autorize.

---

## 4. Instalar o Git (se não tiver)

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

## 5. Clonar o repositório

```bash
git clone https://github.com/adminadmin-AI/Avequi.git
cd Avequi
```

---

## 6. Instalar dependências do projeto

```bash
npm install
```

---

## 7. Configurar variáveis de ambiente

```bash
cp apps/api/.env.example apps/api/.env
```

Preencha o `.env` com as credenciais reais — peça ao responsável do projeto:
- `DATABASE_URL` — Supabase pooler
- `JWT_SECRET` e `JWT_REFRESH_SECRET`
- `FOCUS_NFE_TOKEN`

---

## 8. Instalar os agentes GSD

O GSD é o framework central de agentes. Instala 33 agentes, 66 skills e hooks automáticos em `~/.claude/`.

```bash
npx get-shit-done-cc@1.40.0
```

Aguarde concluir.

---

## 9. Instalar os squads

Times de agentes especializados (erp-squad, cybersecurity, finance-squad, etc.).

```bash
git clone https://github.com/ohmyjahh/xquads-squads.git ~/xquads-squads
cp -r ~/xquads-squads/* ~/.claude/commands/
```

---

## 10. (Opcional) Plugin Vercel

Só necessário se trabalhar com deploy/infra:

```bash
claude plugin install vercel
```

---

## 11. Abrir o projeto no Claude Code

```bash
claude
```

O Claude carrega o contexto do projeto automaticamente via `CLAUDE.md`.

---

## Verificação final

Dentro do Claude Code, com o projeto aberto, teste:

- `/gsd-help` → lista todos os comandos GSD
- `/erp-squad` → mostra o time de ERP
- `/gsd-health` → verifica saúde do setup

Se os três funcionarem, o setup está completo.

---

## Resumo — tudo em sequência

```bash
# 1. Instalar Claude Code
npm install -g @anthropic-ai/claude-code

# 2. Autenticar (abre o browser)
claude

# 3. Clonar o projeto
git clone https://github.com/adminadmin-AI/Avequi.git
cd Avequi

# 4. Instalar dependências
npm install

# 5. Configurar .env
cp apps/api/.env.example apps/api/.env
# → preencher manualmente com as credenciais

# 6. Instalar agentes GSD
npx get-shit-done-cc@1.40.0

# 7. Instalar squads
git clone https://github.com/ohmyjahh/xquads-squads.git ~/xquads-squads
cp -r ~/xquads-squads/* ~/.claude/commands/

# 8. Abrir o projeto
claude
```

---

## Squads disponíveis para este projeto

| Comando | Descrição |
|---------|-----------|
| `/erp-squad` | NestJS, MRP, regras ERP, Fiscal/NFe |
| `/synapse` | Gestão de regras de domínio |
| `/cybersecurity` | Pentest, auditoria de segurança |
| `/gsd-plan-phase` | Planejar nova fase ou módulo |
| `/gsd-execute-phase` | Executar plano com commits atômicos |
| `/gsd-code-review` | Revisar código antes de PR |
| `/gsd-debug` | Debug com método científico |
| `/gsd-secure-phase` | Verificar mitigações de segurança |
| `/gsd-new-project` | Criar roadmap de novo milestone |
| `/advisory-board` | Conselho estratégico (Naval, Munger, Reid...) |
| `/finance-squad` | Modelagem financeira, CFO virtual |

---

## Dúvidas?

Fale com **@adminadmin-AI** no GitHub ou abra uma issue em https://github.com/adminadmin-AI/Avequi.
