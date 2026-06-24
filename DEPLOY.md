# Deploy — Avequi ERP

> **Para o time (frontend + backend):** este documento explica a estratégia de
> deploy do monorepo de forma que **cada um deploya sua parte de forma
> independente, em sua própria conta, tudo em free tier**, sem um pisar no outro.
>
> Nada aqui muda código de aplicação ou o dev local. Os arquivos adicionados
> (`apps/api/Dockerfile`, `render.yaml`, `apps/web/vercel.json`, `.dockerignore`)
> são **aditivos e dormentes** — só agem quando você conecta o repo a uma
> plataforma.

---

## TL;DR

| Camada | Plataforma | Conta | Plano | Config no repo |
|--------|-----------|-------|-------|----------------|
| **Frontend** (`apps/web`, Next.js) | **Vercel** | do **Rafael** | Hobby (free) | `apps/web/vercel.json` |
| **Backend** (`apps/api`, NestJS) | **Render** (ou Railway/Fly) | do **dev backend** | free | `render.yaml` + `apps/api/Dockerfile` |
| **Banco** | Supabase | compartilhada | free | já em uso |
| **Redis** (Bull) | Upstash | do dev backend | free | via `REDIS_URL` |

**Regra de ouro:** frontend e backend **não compartilham conta de deploy**. Cada
um conecta o **mesmo repo GitHub** à **sua própria plataforma**, com root
directory diferente. Assim ninguém entope a fila do outro.

---

## Por que o backend NÃO vai pro Vercel

A API NestJS usa **filas Bull** + **cron jobs** (`@nestjs/schedule`) — ou seja,
**processos que rodam o tempo todo**. O Vercel é **serverless** (funções
efêmeras), então:

- filas Bull precisam de um worker persistente → ❌ não roda em serverless;
- cron jobs precisam de processo sempre-ligado → ❌ não roda em serverless.

➡️ Tentar deployar a API no Vercel **falha ou fica preso buildando** — foi
exatamente o que aconteceu com o projeto `avequi` (ver seção "Limpeza" abaixo).
O backend precisa de um **host de processo/container**: Render, Railway ou Fly.io
(todos com free tier).

---

## Frontend — deploy na Vercel (Rafael)

> Não precisa de acesso à conta de ninguém. O Rafael importa o repo na **conta
> Vercel dele**.

1. Vercel (conta do Rafael) → **Add New → Project** → importar `adminadmin-AI/Avequi`.
2. **Root Directory** = `apps/web`.
3. Framework: **Next.js** (autodetectado; pinado em `apps/web/vercel.json`).
4. **Environment Variables:**
   - `NEXT_PUBLIC_API_URL` = URL pública do backend + `/api`
     (ex.: `https://avequi-api.onrender.com/api`).
5. Deploy. Os próximos `git push` na `main` disparam deploy automático **na conta
   do Rafael**.

**Opcional (evitar rebuild à toa):** como é Turborepo, dá pra setar o
*Ignored Build Step* do projeto para `npx turbo-ignore @gdr-erp/web` — assim o
front só rebuilda quando `apps/web` (ou suas deps) mudam. Deixei **desligado por
padrão** porque o `turbo-ignore` pode pular o *primeiro* deploy; ative depois que
o projeto já tiver o 1º deploy verde.

---

## Backend — deploy no Render (dev backend)

> Conta Render própria (free). O `render.yaml` na raiz já descreve o serviço.

1. Render → **New → Blueprint** → conectar `adminadmin-AI/Avequi`.
   O Render lê o `render.yaml` e cria o serviço **`avequi-api`** (Docker).
2. Preencher as **Environment Variables** marcadas `sync: false`:
   - `DATABASE_URL`, `DIRECT_URL` → Supabase (pooler + conexão direta).
   - `REDIS_URL` → Upstash (**obrigatório**, senão a API não sobe — validação Joi).
   - `JWT_SECRET`, `JWT_REFRESH_SECRET`, `WEB_URL` (URL do front p/ CORS), e os
     demais segredos do `apps/api/.env` (Focus NFe, `BANK_ENCRYPTION_KEY`…).
3. **Migrations:** rodar `npx prisma migrate deploy` (ex.: como *pre-deploy
   command* no Render, ou manualmente). Lembrando a regra do projeto:
   *migrations nunca dão DROP*.

### ⚠️ Heads-up Redis (ajuste provável no backend)

O `app.module.ts` (~linha 80) hoje extrai **só host/port** de `REDIS_URL`:

```ts
const url = config.get('REDIS_URL') ?? 'redis://localhost:6379';
// usa parsed.hostname e parsed.port — ignora senha e TLS
```

Redis gerenciado (Upstash/Railway) usa **senha + TLS** (`rediss://...`). Então,
ao plugar o Upstash, provavelmente vai precisar **passar `password` e `tls` pro
`BullModule`**, ou simplificar para entregar a URL inteira ao ioredis
(`redis: process.env.REDIS_URL`). *Não mexi nesse código* — fica a seu critério.

### Ponte de porta (já resolvida no Dockerfile)

O `main.ts` faz bind em `API_PORT`, mas Render/Railway/Fly injetam `$PORT`. O
`Dockerfile` já mapeia `$PORT → API_PORT` em runtime — **sem precisar mexer no
código**.

### Alternativas ao Render (mesmo Dockerfile serve)

- **Railway** — dá Redis junto; usa créditos de trial e depois é pago.
- **Fly.io** — free allowance; ótimo pra processo sempre-ligado.

---

## Limpeza recomendada na conta Vercel do backend (quem tem acesso)

Hoje existem **dois** projetos Vercel ligados ao repo: `avequi-web` (o front, ok)
e **`avequi`** (redundante — provavelmente tentando buildar a API, que não roda
em serverless). Na conta Vercel onde eles vivem:

1. Projeto **`avequi`** → **Settings → Git** → **desconectar/pausar** o
   auto-deploy. Ele só entope a fila (Hobby builda 1 por vez) e nunca vai subir.
2. (Opcional) manter `avequi-web` ou migrar o front 100% pra conta do Rafael.

Isso elimina os builds presos que vínhamos vendo.

---

## Ressalvas de free tier (honestas)

- **Vercel Hobby é não-comercial.** Pra MVP/dev tudo bem; produção "de verdade"
  de um ERP pediria o plano Pro (US$ 20/mês).
- **Render free** dorme após ~15 min sem tráfego → cold start de ~30–60s no
  próximo request. Ok pra dev; chato pra ERP em produção (Railway/Fly evitam isso).
- **Upstash free**: ~10k comandos/dia, 256 MB — suficiente pra volume baixo de filas.
- **Supabase free**: 500 MB e pausa após ~1 semana de inatividade.

---

## Resumo do fluxo

```
git push main
   ├── Vercel (conta Rafael)   → builda apps/web  → frontend no ar
   └── Render (conta backend)  → builda apps/api  → API no ar
        (Supabase = banco · Upstash = redis/filas)
```

Cada deploy é independente, em conta própria, free. 🚀
