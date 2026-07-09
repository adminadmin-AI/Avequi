# UI-SPEC — #395 Formação de Preço (Calculadora)

> Contrato de design da tela. Trava layout, componentes, estados e cópia **antes** de codar.
> Stack real do `apps/web`: Next 14 (app router, client components) · Tailwind (tokens `brand-*`) · componentes Radix/shadcn em `@/components/ui/*` · React Query (`@tanstack/react-query`) · axios `@/lib/api-client` · `formatBRL/formatDate` de `@/lib/format`. Sem lib nova.

---

## 1. Rota & navegação
- **Rota:** `apps/web/src/app/app/finance/pricing/page.tsx` (`'use client'`).
- **Nav:** registrar em `@/lib/nav-config.ts` no grupo **Financeiro**, item "Formação de Preço" (ícone `Calculator` do lucide). Guard de rota por permissão já existente — exige `products.pricing.view` (mesma do endpoint).
- **Título/breadcrumb:** `PageHeader` → título "Formação de Preço", subtítulo "Custo + impostos + margem desejada".

## 2. Contrato de dados (fonte da verdade = backend em prod)
- **Endpoint:** `GET /api/pricing/simulate?productId=&marginPct=&costOverride=` (permissão `products.pricing.view`).
- **Params:** `productId` (obrigatório), `marginPct` (obrigatório, número ≥ 0), `costOverride` (opcional, what-if de custo base).
- **Type (colar em `@/types/api.ts`, espelha `PricingSimulation` do backend):**
```ts
export interface PricingSimulation {
  productId: string; sku: string; name: string;
  productType: ProductType | null;
  cost: {
    base: number;
    source: 'override' | 'avgCost' | 'costPrice';
    materialFromBom: number | null;
    conversion: number | null;                // base − material (MOD+CIF implícito no avgCost)
    breakdown: Array<{ componentId: string; sku: string; name: string;
                       quantity: number; unitCost: number; subtotal: number }> | null;
  };
  taxes: { ruleId: string | null; totalPct: number;
           icmsPct: number; ipiPct: number; pisPct: number; cofinsPct: number;
           warning?: string };
  marginPct: number;
  suggestedPrice: number;
  currentPrice: number | null;
  comparison: { delta: number | null; deltaPct: number | null; currentMarginPct: number | null };
}
```
- **Fetch:** React Query. `enabled: !!productId && marginPct !== ''` (só dispara com produto + margem). Chave `['pricing-simulate', productId, marginPct, costOverride]`. Seleção de produto reusa o hook de lista existente (`useList`/`use-resource`) sobre `/products` (combobox por sku+nome).

## 3. Layout (desktop ≥1024px → 2 colunas; mobile → empilha)
```
┌ PageHeader ─────────────────────────────────────────────┐
├──────────────────────┬──────────────────────────────────┤
│ Card "Parâmetros"    │ Card "Preço sugerido" (destaque)  │
│  • Combobox Produto  │   suggestedPrice (grande, brand)  │
│  • Input Margem %    │   badge fonte do custo             │
│  • Input Custo (opc) │   vs atual: delta R$ + deltaPct %  │
│  [what-if hint]      │   (seta ↑verde/↓vermelho)          │
│                      ├──────────────────────────────────┤
│                      │ Card "Composição do custo"        │
│                      │  base · material BOM · conversão   │
│                      │  DataTable breakdown (se houver)   │
│                      ├──────────────────────────────────┤
│                      │ Card "Impostos" totalPct + linhas  │
│                      │  ICMS/IPI/PIS/COFINS (badges %)    │
│                      │  Alert warning (se sem TaxRule)    │
└──────────────────────┴──────────────────────────────────┘
```

## 4. Componentes (só reuso de `@/components/ui/*`)
| Elemento | Componente |
|---|---|
| Cabeçalho | `PageHeader` (de `@/components/page-header`) |
| Cartões | `Card`/`CardHeader`/`CardTitle`/`CardContent` |
| Seleção de produto | `Combobox` (busca por sku/nome) |
| Margem % / Custo override | `Input` + `Field`/`Label` (sufixo `%` e `R$`; usar `MaskedInput` se aplicável) |
| Fonte do custo / % impostos | `Badge` (variant `info`/`neutral`) |
| Breakdown BOM | `DataTable` (`Column[]`: SKU, componente, qtd, custo unit., subtotal) |
| Aviso sem TaxRule | `Alert` (variant `warning`) |
| Carregando | `Spinner` / `Skeleton` nos cartões de resultado |
| Sem produto selecionado | `EmptyState` |
| Erro | `ErrorState` |

## 5. Estados (todos mapeados a respostas reais do backend)
- **Idle** (sem produto): `EmptyState` "Selecione um produto e informe a margem para simular o preço".
- **Loading:** `Skeleton` nos cartões de resultado (mantém parâmetros interativos).
- **Sucesso:** renderiza cartões. Se `comparison.currentPrice == null` → esconder bloco "vs atual".
- **Aviso (200 c/ `taxes.warning`):** `Alert warning` no cartão de impostos; `totalPct` mostra 0% e nota "impostos não considerados".
- **Erros (do controller/service):**
  - `400` margem+impostos ≥ 100% → toast + banner "Preço inviável: margem + impostos ≥ 100%".
  - `422` produto sem custo → banner "Produto sem custo cadastrado — informe um custo (what-if) ou cadastre avgCost/costPrice", com foco no input de custo.
  - `404` produto não encontrado → `ErrorState`.
- **Sem BOM** (`cost.breakdown == null`): esconder tabela; mostrar só base/conversão com nota "produto sem BOM ativa".

## 6. Formatação & tokens
- Dinheiro: `formatBRL` (ex.: `R$ 1.842,00`). Percentuais: 2 casas + `%`.
- Preço sugerido: `text-3xl font-semibold text-brand-700` (destaque). Delta positivo `text-emerald-600` + ícone `TrendingUp`; negativo `text-red-600` + `TrendingDown`.
- Espaçamento: `space-y-6` entre cartões, `gap-6` no grid, `p-6` interno (padrão das páginas finance).

## 7. Cópia (PT-BR)
- Labels: "Produto", "Margem desejada (%)", "Custo base (what-if, opcional)".
- Fonte do custo → badge: `override`="Custo informado", `avgCost`="Custo médio", `costPrice`="Custo padrão".
- Cartões: "Preço sugerido", "Composição do custo", "Impostos", "Comparativo com preço atual".

## 8. Acessibilidade & responsivo
- Inputs com `<Label htmlFor>`; combobox navegável por teclado (já é o comportamento do componente).
- Grid `lg:grid-cols-2`, empilha `<lg`. Tabela BOM com scroll horizontal em telas pequenas.
- Cores nunca como único sinal: delta usa ícone + sinal além da cor.

## 9. Critérios de aceite (fecham #395)
1. Selecionar produto + margem → chama `/pricing/simulate` e exibe preço sugerido.
2. Breakdown de custo (material BOM + conversão) visível quando há BOM.
3. Impostos discriminados (ICMS/IPI/PIS/COFINS + total) e aviso quando não há TaxRule.
4. Comparativo vs `salePrice` atual (delta R$/%, margem líquida realizada) quando existe preço atual.
5. What-if de custo (`costOverride`) recalcula.
6. Erros 400/422/404 tratados com mensagem clara (sem stack).
7. Rota guardada por `products.pricing.view`; item no menu Financeiro.

## 10. Fora de escopo
- Salvar/persistir preço sugerido no produto (só simulação — issue não pede).
- Cenários multi-UF / exportação (backlog).
