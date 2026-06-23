# Guia de Contribuição — Avequi ERP (GDR Reboques)

> Documento obrigatório para qualquer pessoa que trabalhe neste repositório.  
> Leia do início ao fim antes de escrever a primeira linha de código.

---

## Índice

1. [Visão Geral do Projeto](#1-visão-geral-do-projeto)
2. [Stack Tecnológica](#2-stack-tecnológica)
3. [Ambiente de Desenvolvimento](#3-ambiente-de-desenvolvimento)
4. [Banco de Dados](#4-banco-de-dados)
5. [Padrão Visual — Brandbook](#5-padrão-visual--brandbook)
6. [Estrutura do Repositório](#6-estrutura-do-repositório)
7. [Convenções de Código](#7-convenções-de-código)
8. [Padrão de Commits](#8-padrão-de-commits)
9. [Fluxo de Branches](#9-fluxo-de-branches)
10. [Testes](#10-testes)
11. [Checklist de PR](#11-checklist-de-pr)
12. [Links Importantes](#12-links-importantes)

---

## 1. Visão Geral do Projeto

O **Avequi ERP** é um sistema ERP industrial desenvolvido para a **GDR Reboques**. Substitui processos fragmentados (WhatsApp, planilhas, anotações) por um sistema integrado que cobre fábrica, estoque, compras, MRP, produção, logística, lojas e financeiro.

**Documento de referência completo:** [`docs/PRD.md`](docs/PRD.md)

---

## 2. Stack Tecnológica

> Todas as decisões de stack são obrigatórias. Nenhum módulo pode ser desenvolvido em tecnologia diferente sem aprovação explícita.

| Camada | Tecnologia | Versão |
|---|---|---|
| Monorepo | Turborepo | ^2.3 |
| Backend | NestJS | ^10 |
| ORM | Prisma | ^5 |
| Banco de dados | PostgreSQL (Supabase) | — |
| Frontend | Next.js | 14 |
| Linguagem | TypeScript | — |
| Gerenciador de pacotes | npm workspaces | — |
| Testes backend | Jest | — |
| Filas | BullMQ | — |
| Monitoramento de erros | Sentry | — |
| CI/CD | GitHub Actions | — |
| Integração fiscal | Focus NFe (API REST) | — |

**Não usar:** Python, Ruby, Go, ou qualquer outra linguagem no repo. Node.js/TypeScript é suficiente para scripts e automações.

---

## 3. Ambiente de Desenvolvimento

### Pré-requisitos

- Node.js >= 20.0.0
- npm >= 10
- Acesso ao Supabase (ver seção 4)

### Setup inicial

```bash
# 1. Clonar o repositório
git clone https://github.com/adminadmin-AI/gdr-erp.git
cd gdr-erp

# 2. Instalar dependências
npm install

# 3. Configurar variáveis de ambiente
cp apps/api/.env.example apps/api/.env
# Preencher com as credenciais do Supabase (ver seção 4)

# 4. Gerar cliente Prisma
cd apps/api && ../../node_modules/.bin/prisma generate

# 5. Rodar migrações
../../node_modules/.bin/prisma migrate deploy
```

### Subir a API (backend)

```bash
cd apps/api
../../node_modules/.bin/nest start
# API disponível em http://localhost:3000
```

### Subir o frontend

```bash
cd apps/web
npm run dev
# Frontend disponível em http://localhost:3001
```

### Rodar tudo junto

```bash
# Na raiz do monorepo
npm run dev
```

### Deploy e Preview (Vercel)

O frontend está conectado ao **Vercel** para deploy automático.

| Ambiente | URL | Quando |
|---|---|---|
| Produção | https://avequi.vercel.app | Push na branch `main` |
| Preview | URL gerada por PR | Cada Pull Request gera um link único |

```
git push origin main
       ↓
Vercel detecta o push automaticamente
       ↓
Build: npm install → turbo build --filter=web
       ↓
Deploy em https://avequi.vercel.app
```

**Para ver o status de um deploy:**
```bash
vercel ls              # lista deploys recentes
vercel inspect <url>  # detalhes de um deploy específico
```

> O Vercel faz deploy apenas do frontend (`apps/web`). O backend (API) roda no Supabase + VPS futuramente.

---

## 4. Banco de Dados

### Supabase — Produção/Desenvolvimento

| Campo | Valor |
|---|---|
| Dashboard | https://supabase.com/dashboard/project/avliarleakraczikvwwz |
| Pool (usar sempre) | `postgresql://postgres.avliarleakraczikvwwz:****@aws-1-us-west-2.pooler.supabase.com:6543/postgres` |
| Porta direta (5432) | **Bloqueada** — sempre usar a porta 6543 (pooler) |

> **Importante:** A `DIRECT_URL` na porta 5432 está bloqueada pelo Supabase. Use exclusivamente o pooler na porta 6543.

### Credencial de administração (ambiente de dev)

```
Email:    admin@gdr.com.br
Senha:    Admin@123
Perfil:   SUPER_ADMIN
Company:  1f885505-37df-426f-b885-2a7ac889763c (GDR)
```

### Comandos Prisma

```bash
# SEMPRE usar o binário local (não npx prisma)
cd apps/api
../../node_modules/.bin/prisma generate     # gerar cliente
../../node_modules/.bin/prisma migrate dev  # criar migration
../../node_modules/.bin/prisma migrate deploy # aplicar em prod
../../node_modules/.bin/prisma studio       # interface visual
```

### Regras críticas de schema

Estas regras não podem ser alteradas sem alinhamento com o time:

| Modelo | Regra |
|---|---|
| `StockBalance` | Campos: `available`, `reserved`, `inTransit`, `pendingPutaway` |
| `SalesOrder` | Sem `orderNumber` nem `totalAmount` — calcular de `items[]` |
| `StockMovement` | Campo `quantity` (não `qty`), sem `unitCost` |
| `Customer` | Campo `document` (não `taxId`), tem `city` e `state` |
| `Supplier` | Campo `cnpj` (não `taxId`), sem `city`/`state`; email dentro de `contact` |
| `Product` | Campos `costPrice`, `salePrice`, `avgCost`; tem `minStock` |
| `User` | Sem campo `phone` |
| Colunas | camelCase no banco, exceto `gdr_serial_number` com `@map` |
| Tabela NF-e entrada | `gdr_inbound_nfe` |

### Regra de migração

**Migrations nunca fazem DROP.** Apenas mudanças aditivas. Erros são corrigidos com movimentos de estorno, não com deleção de dados.

---

## 5. Padrão Visual — Brandbook

**Brandbook completo:** https://avequi-brandbook.vercel.app/  
**Referência rápida:** [`docs/BRANDBOOK.md`](docs/BRANDBOOK.md)

Todo trabalho de frontend deve seguir o brandbook v2.0. Em resumo:

- **Cor primária:** `#3D2CE6` (Indigo-600)
- **Cor de destaque:** `#00C2A8` (Teal)
- **Fonte:** Inter (UI) + JetBrains Mono (dados/valores)
- **Ícones:** Lucide Icons (stroke 1.5px, never filled)
- **Espaçamento:** escala de 4px
- **Valores monetários:** `R$ 1.234,56` — nunca `1234.56`
- **CNPJ:** `14.123.456/0001-89` — nunca `14123456000189`

---

## 6. Estrutura do Repositório

```
gdr-erp/
├── apps/
│   ├── api/              # NestJS — backend
│   │   ├── src/
│   │   │   ├── modules/  # Um módulo por domínio
│   │   │   ├── common/   # Guards, interceptors, filtros globais
│   │   │   └── prisma/   # PrismaService
│   │   └── prisma/
│   │       └── schema.prisma
│   └── web/              # Next.js — frontend
│       ├── app/
│       │   ├── (auth)/   # Login, registro
│       │   └── (app)/    # App autenticado
│       ├── components/
│       │   └── ui/       # Design system (F0)
│       ├── lib/
│       │   ├── api-client.ts
│       │   ├── hooks/
│       │   └── formatters.ts
│       ├── stores/       # Zustand
│       └── types/        # Tipos TypeScript
├── docs/
│   ├── PRD.md            # PRD Técnico v2.0
│   └── BRANDBOOK.md      # Referência rápida do brandbook
├── CONTRIBUTING.md       # Este arquivo
└── turbo.json
```

---

## 7. Convenções de Código

### TypeScript

- **Strict mode** não está habilitado globalmente (legado), mas todo código novo deve ser tipado explicitamente
- `any` é `warn` — evite. Use generics ou tipos específicos
- Variáveis prefixadas com `_` são ignoradas pelo linter (`_param`)

### NestJS (backend)

```typescript
// ✅ Correto — exceção tipada
throw new StockInsufficientException(productId, requested, available);

// ❌ Errado — exceção genérica
throw new Error('Estoque insuficiente');
```

- Cada domínio é um **módulo NestJS independente**
- Módulos se comunicam via `EventEmitter2` — **nunca** acessando o repositório de outro módulo diretamente
- Todo endpoint de escrita (POST/PUT/PATCH/DELETE) valida DTO com `class-validator`
- Todo endpoint de escrita chama `AuditModule` antes de retornar
- `SELECT FOR UPDATE` obrigatório ao alterar `StockBalance`

### Next.js (frontend)

- Componentes em `components/ui/` usam **CVA** (class-variance-authority) para variantes
- Formulários com **react-hook-form** + **zod** para validação
- Estado servidor/cliente com **React Query** (`@tanstack/react-query`)
- Estado global com **Zustand**
- Formatação de dados com `lib/formatters.ts` — não formatar inline

### Formatação de dados (obrigatória)

```typescript
// ✅ Correto
formatBRL(1234.56)     // → "R$ 1.234,56"
formatCNPJ('14123456000189')  // → "14.123.456/0001-89"
formatDate(date)       // → "12/05/2026"

// ❌ Errado — nunca formatar inline
`R$ ${value.toFixed(2)}`
```

### Entidades

Toda entidade tem obrigatoriamente:

```prisma
id        String   @id @default(cuid())
companyId String
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
```

Nenhum endpoint expõe dados de outra `company` — guard de tenant validado em todo request.

---

## 8. Padrão de Commits

Seguimos **Conventional Commits**:

```
<tipo>(<escopo>): <descrição curta>

[corpo opcional]

[rodapé opcional — ex: Closes #42]
```

### Tipos

| Tipo | Quando usar |
|---|---|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `docs` | Apenas documentação |
| `refactor` | Refatoração sem mudança de comportamento |
| `test` | Adição ou correção de testes |
| `ci` | Mudanças no CI/CD |
| `chore` | Tarefas de manutenção |

### Exemplos

```bash
git commit -m "feat(#86): tela de listagem de clientes com paginação"
git commit -m "fix(#92): corrigir cálculo de saldo devedor em FinancialEntry"
git commit -m "test(estoque): adicionar teste de concorrência em StockBalance"
```

> Sempre referenciar o número da issue (`#XX`) quando houver.

---

## 9. Fluxo de Branches

```
main
 └── feat/#79-componentes-ui-base
 └── feat/#86-cadastro-clientes
 └── fix/#92-saldo-financeiro
```

- `main` — sempre estável, CI deve estar verde
- Branch por issue: `feat/#<numero>-<descricao-curta>`
- PR para `main` sempre requer revisão
- Squash merge no PR para manter histórico limpo

---

## 10. Testes

### Backend

```bash
cd apps/api
npm test              # todos os testes
npm test -- --watch  # modo watch
npm test -- --coverage # com cobertura
```

**Obrigatoriedade de testes unitários para:**
- Engine MRP
- Cálculo de custo médio
- Regras de estoque (concorrência, saldo negativo)
- Validações fiscais (CNPJ/CPF)

**Meta atual:** 633 testes, 0 falhas. Não faça merge de código que quebre testes existentes.

### Frontend

```bash
cd apps/web
npm test
```

---

## 11. Checklist de PR

Antes de abrir um Pull Request, confirme:

**Código**
- [ ] Todos os testes passando (`npm test`)
- [ ] Sem erros de lint (`npm run lint`)
- [ ] Sem `console.log` ou `debugger` esquecidos
- [ ] DTOs validados com `class-validator` (endpoints de escrita)
- [ ] Exceções tipadas (não `throw new Error('...')`)

**Banco de dados**
- [ ] Migration é aditiva (sem DROP)
- [ ] `SELECT FOR UPDATE` em operações de estoque
- [ ] `companyId` presente e validado em todas as queries

**Frontend**
- [ ] Segue o brandbook (cores, tipografia, ícones)
- [ ] Formatação via `lib/formatters.ts`
- [ ] Componentes usam tokens do design system (sem hex hardcoded)
- [ ] Estados de loading e empty implementados
- [ ] Touch targets mínimos respeitados (40px padrão, 48px touch, 72px floor)

**Segurança**
- [ ] Sem variáveis sensíveis no código (usar `.env`)
- [ ] Guard de tenant em todos os endpoints
- [ ] Rate limiting em endpoints públicos

**Documentação**
- [ ] Issue referenciada no commit/PR
- [ ] Mudanças de schema documentadas se necessário

---

## 12. Links Importantes

| Recurso | Link |
|---|---|
| Repositório de código | https://github.com/adminadmin-AI/Avequi |
| Issues & backlog | https://github.com/adminadmin-AI/Avequi |
| Project board (GitHub Projects) | https://github.com/users/adminadmin-AI/projects/7 |
| Vercel (deploy/preview) | https://avequi.vercel.app |
| Supabase (banco de dados) | https://supabase.com/dashboard/project/avliarleakraczikvwwz |
| Brandbook v2.0 | https://avequi-brandbook.vercel.app/ |
| PRD Técnico | [`docs/PRD.md`](docs/PRD.md) |
| Sentry (monitoramento) | Configurado via `SENTRY_DSN` em `.env` |
| Focus NFe (fiscal) | https://focusnfe.com.br |
