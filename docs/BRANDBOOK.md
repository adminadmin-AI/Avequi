# Brandbook Avequi — Referência Rápida v2.0

> Referência rápida para uso no dia a dia de desenvolvimento.  
> **Brandbook completo e interativo:** https://avequi-brandbook.vercel.app/

---

## Índice

1. [Cores](#1-cores)
2. [Tipografia](#2-tipografia)
3. [Espaçamento e Border Radius](#3-espaçamento-e-border-radius)
4. [Sombras](#4-sombras)
5. [Ícones](#5-ícones)
6. [Componentes](#6-componentes)
7. [Motion e Animações](#7-motion-e-animações)
8. [Formatação de Dados Brasileiros](#8-formatação-de-dados-brasileiros)
9. [Personas e Densidades](#9-personas-e-densidades)
10. [Acessibilidade](#10-acessibilidade)
11. [Identidade Verbal e Glossário](#11-identidade-verbal-e-glossário)
12. [Anti-padrões](#12-anti-padrões)
13. [Checklist de Novo Componente](#13-checklist-de-novo-componente)

---

## 1. Cores

### Cores Primárias da Marca

```css
--color-brand-primary:  #3D2CE6;  /* Indigo-600 — uso principal */
--color-brand-hover:    #3427D1;  /* Indigo-700 — hover */
--color-brand-dark:     #818CF8;  /* Indigo-400 — dark mode */
--color-brand-accent:   #00C2A8;  /* Teal — destaque */
```

**Gradiente da marca:**
```css
background: linear-gradient(135deg, #3D2CE6, #00C2A8);
```

### Paleta Neutra (Slate)

```css
--slate-50:  #F8FAFC;
--slate-100: #F1F5F9;
--slate-200: #E2E8F0;
--slate-300: #CBD5E1;
--slate-400: #94A3B8;
--slate-500: #64748B;
--slate-600: #475569;
--slate-700: #334155;
--slate-800: #1E293B;
--slate-900: #0F172A;
```

### Cores Semânticas

```css
--color-success: #16A34A;  /* green-600 */
--color-warning: #F59E0B;  /* amber-500 */
--color-danger:  #DC2626;  /* red-600 */
--color-info:    #2563EB;  /* blue-600 */
```

### Status NF-e / SEFAZ

```css
--nfe-autorizada:    #16A34A;
--nfe-rejeitada:     #DC2626;
--nfe-cancelada:     #6B7280;
--nfe-pendente:      #D97706;
--nfe-transmitindo:  #2563EB;
--nfe-denegada:      #7C3AED;
--nfe-contingencia:  #EA580C;
```

### Status Produção / Chão de Fábrica

```css
--op-em-execucao: #16A34A;
--op-pausada:     #EAB308;
--op-parada:      #DC2626;
--op-aguardando:  #9CA3AF;
--op-concluida:   #0EA5E9;
```

### Paleta para Gráficos (8 cores acessíveis)

```
1. #6366F1  Indigo
2. #0EA5E9  Sky
3. #10B981  Emerald
4. #F59E0B  Amber
5. #EF4444  Red
6. #8B5CF6  Violet
7. #EC4899  Pink
8. #64748B  Slate
```

---

## 2. Tipografia

### Fontes

```css
font-family: 'Inter', system-ui, sans-serif;        /* UI e body */
font-family: 'JetBrains Mono', monospace;           /* dados, valores, códigos */
```

### Escala de Tipos

| Token | Tamanho | Peso | Letter-spacing | Uso |
|---|---|---|---|---|
| Display | 48px | 700 | -0.04em | Grandes títulos |
| Page Title | 30px | 600 | -0.02em | Títulos de módulos |
| Section | 24px | 600 | -0.01em | Headers de seção |
| Card Title | 20px | 500 | 0 | Títulos de cards |
| Body | 16px | 400 | 0 | Texto principal |
| Body Small | 14px | 400 | 0 | Conteúdo secundário |
| Label | 14px | 500 | 0 | Labels de formulários |
| Overline | 12px | 600 | +0.08em | Labels de seção (uppercase) |
| Mono Data | 14px | 400 | — | Valores financeiros, códigos |
| Chave NF-e | 12px | 400 | — | Chaves de 44 dígitos |

> **Regra:** Use `JetBrains Mono` para qualquer valor numérico financeiro, CNPJ, CPF, chaves NF-e e códigos de produto.

---

## 3. Espaçamento e Border Radius

### Sistema de Espaçamento (base 4px)

```
2px, 4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px, 96px, 128px
```

Nunca usar valores fora desta escala.

### Border Radius

```css
--radius-sm:   4px;    /* badges, tags */
--radius-md:   6px;    /* small buttons */
--radius-lg:   8px;    /* buttons, inputs */
--radius-xl:   12px;   /* cards, modals */
--radius-2xl:  16px;   /* drawers */
--radius-full: 9999px; /* avatars, toggles */
```

### Sidebar

```css
--sidebar-width: 240px;
```

---

## 4. Sombras

```css
--shadow-sm:    0 1px 3px rgba(15,23,42,0.10), 0 1px 2px rgba(15,23,42,0.06);
--shadow-md:    0 4px 6px -1px rgba(15,23,42,0.10), 0 2px 4px rgba(15,23,42,0.06);
--shadow-xl:    0 20px 25px -5px rgba(15,23,42,0.10), 0 8px 10px rgba(15,23,42,0.04);
--shadow-brand: 0 4px 14px -3px rgba(61,44,230,0.15), 0 2px 6px rgba(61,44,230,0.08);
```

---

## 5. Ícones

- **Biblioteca:** Lucide Icons (MIT) — fallback Phosphor Icons
- **Estilo:** Apenas outlined, nunca filled
- **Stroke:** 1.5px (interface), 2px (standalone)
- **Linecap/linejoin:** round

### Tamanhos

| Token | Tamanho | Uso |
|---|---|---|
| icon-xs | 12px | Badges inline |
| icon-sm | 16px | Small buttons, inputs |
| icon-md | 20px | Standard buttons, nav |
| icon-lg | 24px | Sidebar, standalone |
| icon-xl | 32px | Empty states |
| icon-2xl | 48px | Floor/warehouse |

### Ícones customizados Avequi

| Ícone | Descrição |
|---|---|
| `avq-nfe` | Arquivo com raio (digital) |
| `avq-ledger` | Livro aberto com colunas de dados |
| `avq-cashflow` | Seta curvada com símbolo R$ |
| `avq-reconcile` | Dois documentos com check bidirecional |
| `avq-period-close` | Calendário com cadeado |

---

## 6. Componentes

### Botões

**Variantes:** `primary` `secondary` `ghost` `destructive` `link`

| Tamanho | Altura | Fonte | Padding horizontal |
|---|---|---|---|
| Small | 32px | 13px | 12px |
| Medium | 40px | 14px | 16px |
| Large | 48px | 15px | 20px |

**Cores:**
```css
/* Primary */
background: #3D2CE6;  hover: #3427D1;
/* Destructive */
background: #DC2626;
```

### Inputs

- Altura padrão: 40px
- Focus ring: 3px offset, brand color
- Erro: borda vermelha + texto 12px abaixo

### Badges de Status

| Variante | Background | Texto |
|---|---|---|
| Success | `#DCFCE7` | `#166534` |
| Warning | `#FEF3C7` | `#92400E` |
| Danger | `#FEE2E2` | `#991B1B` |
| Info | `#DBEAFE` | `#1D4ED8` |
| Neutral | surface-sunken | text-secondary |
| Brand | `#E0E7FF` | `#3730A3` |

### Cards

| Variante | Comportamento |
|---|---|
| Surface | Background sutil, border, flat |
| Elevated | Surface + shadow |
| Outlined | Branco/surface + border |
| Interactive | Hover: border indigo + shadow + `translateY(-2px)` |

### Tabelas

- Header: 11px, peso 600, uppercase, background surface-subtle, sticky
- Altura de linha: 44px (executive) a 72px (floor)
- Hover: background surface-subtle
- Valores monetários: right-aligned, JetBrains Mono

---

## 7. Motion e Animações

### Duration Tokens

| Token | Valor | Contexto |
|---|---|---|
| motion-instant | 0ms | Mudanças de estado imediatas |
| motion-micro | 80ms | Hover de cor, opacidade |
| motion-fast | 120ms | Hover, focus ring, tooltip |
| **motion-flow** | **200ms** | **Transição padrão** |
| motion-deliberate | 320ms | Modal, drawer, confirm |
| motion-sequence | 500ms | Page transition |
| motion-orbital | 700ms | Logo, SVG draw |
| motion-breath | 2400ms | Ambient loops |

### Curvas de Easing

```css
--ease-flow:     cubic-bezier(0.16, 1, 0.3, 1);    /* padrão, entrada de dados */
--ease-precise:  cubic-bezier(0.4, 0, 0.2, 1);     /* navegação, tema swap */
--ease-orbital:  cubic-bezier(0.34, 1.56, 0.64, 1); /* confirmações, checkboxes */
--ease-exit:     cubic-bezier(0.4, 0, 1, 1);        /* toasts, drawers fechando */
```

### Stagger (listas)

| Token | Delay | Uso |
|---|---|---|
| stagger-1 | 0ms | Elemento âncora |
| stagger-2 | 40ms | Segundo item |
| stagger-3 | 80ms | Terceiro item |
| stagger-4 | 120ms | Quarto item |
| stagger-5 | 160ms | Quinto item |
| stagger-6 | 200ms | Máximo |

### Padrões de Motion Avequi

| Padrão | Comportamento |
|---|---|
| `avq-data-reveal` | clip-path + opacity in, 280ms ease-flow |
| `avq-orchestrate` | opacity + translateY stagger, 40ms por filho |
| `avq-process-scan` | scaleX 0→1 (barra de progresso), 480ms |
| `avq-confirm-pulse` | scale 1→1.025→1, 320ms ease-orbital |
| `avq-count-build` | contador animado, 900ms |
| `avq-node-breath` | breathing de opacidade/scale, 2400ms |

> **Obrigatório:** Sempre respeitar `@media (prefers-reduced-motion: reduce)` — todas as animações devem ter fallback instantâneo.

---

## 8. Formatação de Dados Brasileiros

> Usar sempre `lib/formatters.ts` — nunca formatar inline.

| Campo | Formato correto | Nunca |
|---|---|---|
| Valor BRL | `R$ 1.234,56` | `1234.56` ou `R$1234,56` |
| CNPJ | `14.123.456/0001-89` | `14123456000189` |
| CPF | `123.456.789-09` | `12345678909` |
| Data | `12/05/2026` | `2026-05-12` |
| Chave NF-e | `4421 0419 9999...` (grupos de 4) | Raw sem espaços |
| CFOP | `5.102` | `5102` |
| NCM | `8471.30.12` | `84713012` |
| Número NF | `000.042` | `42` |

---

## 9. Personas e Densidades

| Persona | Papel | Shell | Densidade | Primeira tela |
|---|---|---|---|---|
| DIRECTOR | Executivo | A | Executive | Dashboard financeiro |
| MANAGER | Líder operacional | A | Operational | Visão geral de OPs |
| FISCAL | Especialista fiscal | A | Operational | Status de NF-e |
| STORE | Ponto de venda | B | Touch | Busca/venda de produto |
| WAREHOUSE | Picker/packer | C | Touch | Lista de separação |
| OPERATOR | Operador de máquina | C | Floor | OP atual + timer |

### Touch Targets por Persona

| Persona | Tamanho mínimo |
|---|---|
| Executive | 32px |
| Operational | 40px |
| Store/Touch | 48px |
| Floor | **72px** (operação com luva) |

---

## 10. Acessibilidade

**Padrão:** WCAG 2.1 AA (AAA para módulos Floor e POS)

### Contrastes mínimos

- Texto normal: 4.5:1
- Texto grande: 3:1
- Componentes UI: 3:1
- Floor/POS: 7:1

### Navegação por teclado

- Tab order lógica e visível
- Focus ring: 3px offset, brand color
- `Escape` fecha modais e drawers
- `⌘K` abre Command Palette
- Arrow keys em dropdowns

### Atributos ARIA obrigatórios

```html
role="navigation" aria-label="..."
aria-expanded aria-controls        <!-- toggles -->
aria-live="polite"                 <!-- notificações toast -->
aria-busy="true"                   <!-- durante loading -->
aria-invalid="true"                <!-- erros de formulário -->
aria-label                         <!-- botões só com ícone -->
```

---

## 11. Identidade Verbal e Glossário

### Tom de voz

**Módulos operacionais** (Produção, WMS, POS, Floor):
> Direto, orientado a ação, foco em confirmação.  
> ✅ "Escanear o item ou digitar o código"  
> ✅ "Quantidade confirmada. Próximo: A-03-13"

**Módulos gerenciais/fiscais** (Financeiro, Fiscal, Admin, Relatórios):
> Preciso, contextual, consciente das consequências.  
> ✅ "NF-e #0042 autorizada pela SEFAZ."  
> ✅ "Esta ação transmite a NF-e — não pode ser cancelada após 24h"

### Tagline e propósito

- **Tagline:** "Feito para quem faz"
- **Missão:** Acabar com o improviso nas operações industriais brasileiras
- **Visão:** Uma indústria brasileira onde nenhum dado crítico vive num grupo de WhatsApp

### Glossário — termos obrigatórios

| Exibir assim | Nunca escrever |
|---|---|
| Ordem de Produção (OP #1234) | "Order", "Job" |
| Lista de Materiais | "BOM" isolado |
| Prazo de entrega do fornecedor | "lead time", "LT" |
| Separação de itens | "picking" em português |
| Armazenamento no depósito | "put-away" |
| CFOP (manter o código) | Tradução livre |
| DANFE | "nota impressa", "PDF" |
| Nota denegada — [motivo] | "rejected" |

---

## 12. Anti-padrões

Nunca fazer:

- Spring animations em dados operacionais (números parecem elásticos)
- Parallax scrolling (contradiz foco em dados)
- Particle effects ou blur-in (parece lifestyle app, não ERP)
- Infinite loop animations em elementos funcionais
- Rainbow shimmer skeleton
- Bounce entrance da esquerda
- Logo distorcido ou com efeitos 3D
- Cores fora do sistema de design
- Valores hex hardcoded nos componentes
- Acessibilidade como pós-pensamento
- Motion sem propósito funcional

---

## 13. Checklist de Novo Componente

Antes de marcar um componente como pronto:

- [ ] Usa tokens semânticos (sem valores hex hardcoded)
- [ ] Funciona nas 4 densidades (Executive, Operational, Touch, Floor)
- [ ] Dark mode testado
- [ ] Estados implementados: default, hover, focus, active, disabled
- [ ] Focus-visible funcional na navegação por Tab
- [ ] WCAG AA de contraste verificado
- [ ] Touch target ≥ 40px (≥ 48px touch, ≥ 72px floor)
- [ ] Atributos ARIA presentes
- [ ] Responsivo: 375px / 768px / 1024px / 1280px
- [ ] Estado de loading implementado
- [ ] Estado empty implementado
- [ ] `prefers-reduced-motion` respeitado
- [ ] Dados fiscais formatados via `lib/formatters.ts`
