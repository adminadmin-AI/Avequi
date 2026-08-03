# Escopo de dados por filial/loja — #347 fase 2

> **Status: 347-A (infraestrutura, SHADOW)** — o mecanismo existe e está
> testado, mas **nenhum service filtra por ele ainda**. A aplicação nos módulos
> é incremental (347-B em diante). Nada muda para os usuários até lá.

## O problema

O RBAC v2 (#341, blocos A–G) responde **"o usuário PODE fazer esta ação?"**.
Ele não responde **"sobre quais dados?"**: um usuário de loja com
`sales.orders.view` enxerga as vendas de TODAS as lojas da empresa, porque os
services filtram apenas por `companyId`.

## O modelo (decisões Rafael, 11/07/2026)

| Nível | Significado | Quem (direção aprovada) |
|---|---|---|
| `COMPANY` | visão ampla da empresa | admins, DIRETOR, AUDITOR, GERENTE_GERAL, FINANCEIRO, FISCAL |
| `BRANCH` | só a(s) filial(is)/loja(s) vinculada(s) | GERENTE_LOJA, LOJA_*, VENDEDOR (ERP core), ALMOXARIFE/SUPERVISOR_ESTOQUE |
| `OWN` | só os próprios registros | preparado; nenhum perfil usa ainda (decisão own×loja do CRM fica no bloco F) |

**Importante:** o nível NÃO vem do perfil — vem do **vínculo**
(`UserRoleAssignment.branchId`). Assignment **sem** branch = `COMPANY`
(retrocompatível: é o estado de 100% dos assignments hoje, então ninguém perde
acesso quando o enforcement ligar). Um vínculo global vence os demais.
Múltiplas lojas = múltiplos assignments com branch (ex.: gerente que acumula
duas lojas).

## As três representações de "filial" (e qual usamos)

| Representação | Onde | Papel |
|---|---|---|
| **Branch** (`gdr_branches`) | IAM/org-structure (#473) | **Entidade de ESCOPO** — é nela que o assignment aponta |
| **Warehouse** | ERP core | **Ponte operacional** — vendas/estoque/WMS/transferências já carregam `warehouseId`; a coluna aditiva `Warehouse.branchId` (347-A) liga o depósito à filial |
| **Company-por-loja** | CRM (`Lead.companyId` = loja) | Modelo próprio do CRM — **fora deste mecanismo até o bloco F (#624)** reconciliar |

Vincular depósito→filial é **cadastro consciente do admin** (sem backfill
automático). Depósito sem branch fica fora de qualquer recorte, como hoje.

## As peças (347-A)

- `Warehouse.branchId` (nullable, FK `gdr_branches`) — migração 100% aditiva.
- `iam/scope.ts` — tipos (`ScopeLevel`, `EffectiveScope`) e o helper central
  **`scopeWhere(scope, opts)`**: `COMPANY → {}`; `BRANCH → { warehouseId:
  { in: [...] } }` (filial sem depósito = `in: []`, **fail-closed**); `OWN →
  { createdById: userId }` (campo configurável).
- `PermissionService.getUserScope(userId, companyId)` — resolve o escopo do
  usuário a partir dos assignments ativos/não expirados. Shadow: ainda não é
  chamado em request path; ganha cache Redis quando entrar no caminho quente.

## Como um service vai consumir (347-B em diante)

```ts
const scope = await this.permissionService.getUserScope(user.id, user.companyId);
const orders = await this.prisma.salesOrder.findMany({
  where: { companyId: user.companyId, ...scopeWhere(scope) },
});
```

Registro fora do escopo responde **404** (anti-enumeração, mesmo padrão dos
anti-IDOR dos blocos A–G). Regras especiais: transferências (origem OU destino
na filial) na 347-C; relatórios/exports respeitando escopo na 347-D.

## Roadmap

- **347-A** ✅ infraestrutura (este doc) — shadow, zero mudança de comportamento.
- **347-B** ✅ vendas/faturamento de loja (caso real: venda balcão #595) —
  entregue em 03/08/2026: todo o `SalesService` consome `scopeWhere` (listagem,
  detalhe e mutações por id respondem 404 fora do recorte; criar venda e listar
  chassis do balcão em depósito de outra filial respondem 403), `getUserScope`
  ganhou cache Redis (TTL 5 min, invalidado junto com o de permissões) e o
  vínculo depósito→filial da GDR tem script idempotente
  (`scripts/backfill-warehouse-branches-347b.ts`, dry-run por padrão:
  ALM-FAB→MATRIZ, LOJA-CAS→CAS, LOJA-GUA→GUA). O recorte só ativa para quem
  receber assignment com `branchId` — sem isso, comportamento de sempre.
- **347-C** estoque/WMS/transferências.
- **347-D** relatórios/exports.
- **CRM** no bloco F, consumindo o mecanismo após reconciliar Company-por-loja.
