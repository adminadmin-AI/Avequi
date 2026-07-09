# UI-SPEC — #397 Forecast Financeiro (gráfico)

Stack: igual às anteriores + **recharts** (já dependência; `ComposedChart`).

## Rota & nav
- `apps/web/src/app/app/finance/forecast/page.tsx`. Menu **Financeiro**, "Forecast Financeiro", ícone `TrendingUp`, `FINANCE_ROLES` (endpoint `@Roles` SUPER_ADMIN/DIRECTOR/MANAGER/FINANCIAL).

## Dados
- `GET /api/forecast/financial?quarters=4` → `FinancialForecast { quarters: QuarterForecast[], assumptions }`.
- `QuarterForecast { quarter, months[], revenue, expenses, result, budgeted|null, realized{revenue,expenses,result,partial}|null }`.

## Layout
- `PageHeader` com `SegmentedControl` (4T/8T/12T) nas actions.
- **3 KPIs:** receita projetada (`brand`), despesa projetada (`danger`), resultado projetado (verde/vermelho).
- **Gráfico** `ComposedChart` (320px): barras Receita (`#3D2CE6`) + Despesa (`#DC2626`), linha Resultado (`#00C2A8`). Grid `#e2e8f0`, eixos `#64748b`, YAxis compacta (k/M), tooltip `formatBRL`.
- **Tabela por trimestre:** trimestre, receita, despesa, resultado (cor por sinal), orçado, realizado (resultado + badge `parcial`).
- Rodapé: fonte do preço, base da tendência (meses), `generatedAt`.

## Estados
- loading: skeletons nos KPIs, no gráfico e na tabela. erro: `ErrorState` + retry.

## Aceite (#397)
1. Projeção trimestral rolante (receita demanda×preço, despesa por tendência). 2. Gráfico receita×despesa×resultado. 3. Comparativo vs orçado e vs realizado (parcial sinalizado). 4. Seletor de horizonte (4/8/12T). 5. Menu Financeiro guardado.
