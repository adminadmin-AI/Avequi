# UI-SPEC — #399 Análise de Investimentos (VPL/TIR + gráfico)

Stack: igual às anteriores + `recharts` (ComposedChart), `FormDialog`, `useConfirm`, `Tabs`, `MultiCombobox`.

## Rota & nav
- `apps/web/src/app/app/finance/investments/page.tsx`. Menu **Financeiro**, "Análise de Investimentos", ícone `Coins`, `FINANCE_ROLES`. Escrita = MANAGER/FINANCIAL/SUPER_ADMIN; aprovar/reprovar = **DIRECTOR/SUPER_ADMIN** (alçada, gate no backend).

## Endpoints
- `GET /investments` · `POST` · `PATCH /:id` · `DELETE /:id`.
- `POST /:id/cashflows` · `DELETE /:id/cashflows/:cid`.
- `GET /:id` (projeto + `analysis`: npv, irrPct, paybackSimple/Discounted, series[]).
- `GET /compare?ids=` · `POST /:id/approve` · `POST /:id/reject`.

## Layout — `Tabs [Análise | Comparar]`
- **Análise:** seletor de projeto (`Combobox`) + Novo projeto. Selecionado → cabeçalho com badge de status (Rascunho/Aprovado/Reprovado) e ações (Aprovar/Reprovar/Editar só em DRAFT; Remover). KPIs: **VPL** (destaque, verde/vermelho), TIR, payback simples, payback descontado, taxa de desconto. **Gráfico** `ComposedChart`: barra Fluxo por período + linhas Acumulado (`brand`) e Acum. descontado (`accent` tracejado), `ReferenceLine y=0`. Tabela de **fluxos** (CRUD só em DRAFT; período 0 = aporte).
- **Comparar:** `MultiCombobox` de projetos → tabela lado a lado (status, VPL, TIR, payback, payback desc.).

## Estados
- Idle `EmptyState`; loading skeleton; erros de mutação/decisão inline (`text-danger`). Projeto fora de DRAFT bloqueia edição de fluxos (aviso).

## Aceite (#399)
1. CRUD projeto + fluxos. 2. VPL, TIR, payback simples e descontado. 3. Série de fluxo acumulado (gráfico). 4. Comparar projetos. 5. Aprovar/Reprovar com alçada DIRECTOR (só em DRAFT). 6. Menu Financeiro guardado.

## Fora de escopo
- Reabrir projeto decidido; templates de fluxo; sensibilidade de taxa (backend não expõe).
