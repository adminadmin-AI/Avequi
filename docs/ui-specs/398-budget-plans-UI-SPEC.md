# UI-SPEC — #398 Budget dirigido por Drivers (CRUD)

Stack: igual às anteriores + `FormDialog`, `useConfirm`, `Tabs`, mutations via `apiClient` + `queryClient`.

## Rota & nav
- `apps/web/src/app/app/finance/budget-plans/page.tsx`. Menu **Financeiro**, "Budget por Drivers", ícone `Target`, `FINANCE_ROLES`. Escrita = SUPER_ADMIN/MANAGER/FINANCIAL (gate no backend).

## Endpoints
- `GET /budget-plans` (lista) · `POST` (criar) · `PATCH /:id` (premissas) · `DELETE /:id`.
- `POST /:id/drivers` (upsert) · `DELETE /:id/drivers/:driverId`.
- `GET /:id/projection` · `GET /:id/sensitivity` · `GET /:id/vs-realized`.

## Layout (master-detail)
- `PageHeader` + botão **Novo plano**. Card seletor de plano (`Combobox`) + Editar premissas / Remover.
- Sem plano: `EmptyState` com CTA.
- Com plano: `Tabs` —
  - **Projeção:** KPIs (receita, CPV, margem bruta, desp. var/fixa, resultado operacional, CAPEX, resultado após CAPEX — sinais coloridos) + tabela de drivers (com mix%).
  - **Drivers (CRUD):** tabela editável; `FormDialog` add/editar driver (rótulo, produto opcional via combobox, volume, preço médio, custo unit.); remover com `useConfirm`.
  - **Sensibilidade:** base + cenários ±10% vol / ±5% preço (Δ receita/resultado com cor por sinal).
  - **vs Realizado:** totais orçado/realizado/variação + tabela por driver (realizado vem de vendas faturadas por produto).
- Dialogs: plano (nome, ano só na criação, %desp var, desp fixa mensal, CAPEX) e driver.

## Estados
- loading skeletons por aba; erros de mutação inline (`text-danger`) no dialog; sensitivity/vs-realized só carregam ao abrir a aba (query `enabled` por tab).

## Aceite (#398)
1. CRUD de plano + drivers. 2. Projeção recalculada dos drivers (receita Σvol×preço, CPV, margem, desp, resultado op., CAPEX). 3. Sensibilidade ±10% vol/±5% preço. 4. Orçado vs realizado por driver. 5. Mix% por driver. 6. Menu Financeiro guardado.

## Fora de escopo
- Duplicar/versionar planos; export. Premissa por mês (backend usa fixa×12).
