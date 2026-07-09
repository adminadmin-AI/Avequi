# UI-SPEC — #396 Custeio por Absorção

Stack: igual ao #395 (Next client · Tailwind brandbook v2.0 · shadcn/Radix `@/components/ui/*` · React Query · `apiClient` · `formatBRL/formatPercent/formatNumber`).

## Rota & nav
- `apps/web/src/app/app/finance/costing/page.tsx` (`'use client'`).
- Nav: grupo **Financeiro**, "Custeio por Absorção", ícone `Layers`, `FINANCE_ROLES`. Endpoints exigem `products.pricing.view`.

## Dados
- `GET /api/costing/cif-rate` → `CifRate { ratePerHour, monthlyCif, monthlyProductiveHours, centers }` (empresa; carrega sempre).
- `GET /api/costing/product/:productId` → `ProductAbsorptionCost { material{total,breakdown[]}, labor{total,hours,breakdown[]}, cif{ratePerHour,hours,total}, totalWithoutCif, totalWithCif, cifImpactPct }` (React Query, `enabled` ao selecionar produto).

## Layout
1. **Card topo "Taxa CIF/hora (empresa)"** — 4 métricas (CIF/hora em `accent`, CIF mensal, horas produtivas, centros ativos).
2. Grid 2 col: **esquerda** combobox de produto; **direita** resultado.
3. Resultado: **Custo por absorção** (totalWithCif destaque `brand`, totalWithoutCif secundário, badge `cifImpactPct` warning; métricas material/MOD/CIF) → **Material (BOM)** DataTable → **MOD** DataTable (horas no título) → **CIF rateado** métricas.

## Estados
- Idle (sem produto) `EmptyState`; loading skeleton; erro `ErrorState` com mensagem da API + retry.
- Sem BOM / sem roteiro: mensagens `text-content-muted` no lugar da tabela.

## Aceite (#396)
1. Taxa CIF/hora da empresa visível. 2. Selecionar produto → custo material+MOD+CIF. 3. Breakdown de material (BOM) e de MOD (operações/roteiro). 4. Comparativo com/sem CIF + impacto % do CIF. 5. Rota no menu Financeiro, guard `products.pricing.view`.

## Fora de escopo
- Config de `monthlyCif`/`monthlyProductiveHours` do centro de custo (fica em Categorias/CC). Auto-update de `avgCost` com CIF (deixado fora no backend por decisão do contador).
