# ERP Squad

> **GDR ERP — Especialistas técnicos** para o sistema industrial + lojas da GDR.
> Stack: NestJS + TypeScript + Prisma + PostgreSQL + Next.js + Focus NFe.

---

## Agentes (3)

| Agente | Domínio | Quando usar |
|--------|---------|-------------|
| **NestJS Architect** ⚙️ | Backend NestJS + Prisma | Módulos, guards, eventos, BullMQ, concorrência de estoque |
| **Fiscal NFe BR** 🧾 | Focus NFe + Legislação BR | CFOP, payloads NF-e/NFC-e, webhook SEFAZ, rejeições |
| **MRP Specialist** 🏭 | MRP, BOM, Produção | Algoritmo MRP, explosão BOM, Ordens de Produção, apontamento |

---

## Referências (3)

Carregue sempre que for gerar código GDR:

| Arquivo | Conteúdo |
|---------|---------|
| `references/gdr-schema.md` | Schema Prisma completo — fonte de verdade do modelo de dados |
| `references/gdr-business-rules.md` | Regras críticas dos 9 domínios + padrões de código obrigatórios |
| `references/gdr-stack.md` | Stack obrigatória, estrutura de módulos, padrões NestJS, checklist multi-tenant |

---

## Como usar

**Implementar um módulo NestJS:**
```
/erp-squad/agents/nestjs-architect
Implemente o StockModule completo:
- StockBalance com SELECT FOR UPDATE
- StockMovement append-only
- Endpoints: GET /stock/balance, POST /stock/movements (ajuste manual)
- Guard: companyId isolation
- Referências: gdr-schema.md + gdr-business-rules.md (domínio 3)
```

**Integração fiscal:**
```
/erp-squad/agents/fiscal-nfe-br
Implemente o FiscalModule NestJS:
- Webhook endpoint para retorno Focus NFe
- Builder de payload NF-e de venda (CFOP 5101/6101)
- Builder de NF-e de transferência (CFOP 5152)
- Listener dos eventos sales.order.invoiced e transfer.shipped
```

**Algoritmo MRP:**
```
/erp-squad/agents/mrp-specialist
Implemente o runMrp() completo:
- Consolidação de demanda
- Explosão de BOM com scrapPct (ROUND_UP)
- Lead time netting
- Lot sizing com lote mínimo
- Snapshot em MrpRun
```

---

## Mapa de Responsabilidades

```
Sprint 01–06 (Auth, Cadastros, Estoque, Compras)
└── nestjs-architect ← estrutura, guards, concorrência

Sprint 07–08 (Vendas + Fiscal)
├── nestjs-architect ← SalesModule, eventos
└── fiscal-nfe-br   ← FiscalModule, NF-e, NFC-e, CFOP

Sprint 09 (Financeiro)
└── nestjs-architect ← FinanceModule, eventos

Sprint 10 (Transferência Loja)
├── nestjs-architect ← LogisticsModule, estoque em trânsito
└── fiscal-nfe-br   ← NF-e CFOP 5152

Sprint 11–13 (MRP — Demanda, Engine, Aprovação)
└── mrp-specialist  ← MrpModule, algoritmo, sugestões

Sprint 14–16 (Produção — OP, Apontamento, Encerramento)
└── mrp-specialist  ← ProductionModule, BOM snapshot, consumo, custo

Sprint 17–20 (WMS — Logística)
└── nestjs-architect ← PickingOrder, putaway, inventário
```

---

## Para o AIOX Dev (Dex) funcionar

O `dev` do AIOX executa stories. Para que o código gerado seja consistente com o GDR:

1. **Sempre incluir nas stories** qual referência carregar (`gdr-schema.md`, `gdr-stack.md`)
2. **Para stories de módulos críticos** (stock, fiscal, MRP): consultar o especialista antes de escrever a story
3. **Setup do projeto**: inicializar `.aiox-core/` com o contexto GDR antes do Sprint 1

---

## Relação com outros squads

| Squad | Quando usar junto com erp-squad |
|-------|--------------------------------|
| **AIOX › architect** | Decisões de arquitetura cross-módulo, API design |
| **AIOX › dev (Dex)** | Execução das stories após o especialista projetar |
| **AIOX › data-engineer** | Schema reviews, query optimization, índices PostgreSQL |
| **AIOX › devops** | CI/CD, Railway deploy, GitHub Actions |
| **AIOX › qa** | Estratégia de testes, casos de borda |
| **finance-squad** | Análise financeira da GDR (não desenvolvimento do módulo) |
| **cybersecurity** | Auditoria de segurança, JWT review, pentest |
