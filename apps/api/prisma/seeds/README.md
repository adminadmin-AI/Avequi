# Seeds de Migração — GDR ERP

Scripts SQL de migração dos dados legados para as tabelas `gdr_*` no Supabase.

## Princípio
- Zero alteração nas tabelas legadas
- Cada tabela GDR tem campo `legacyId` como ponte imutável para o dado original
- Todos os scripts são idempotentes (podem ser re-executados sem duplicação)

## Execução

```bash
# Conexão Supabase (pooler mode)
PGPASSWORD='...' psql "postgresql://postgres.avliarleakraczikvwwz@aws-1-us-west-2.pooler.supabase.com:6543/postgres" -f <script>.sql
```

## Scripts

| Arquivo | Task | Fontes Legadas | Tabelas GDR | Registros |
|---------|------|----------------|-------------|-----------|
| `t3_bom_migration.sql` | T3 — BOM | `sw_bom_conjunto`, `conjunto_pecas`, `modelo_composicao` | `gdr_bom_versions`, `gdr_bom_items` | 68 versões, 720 itens |
| `t7_payables_complement.sql` | T7 complemento | `contas_pagar_departamentos`, `movimentos_financeiros` | `gdr_payable_allocations`, `gdr_payment_entries` | 2.499 alocações, 1.834 baixas |
| `t9_nfe_migration.sql` | T9 — NF-e | `stg_nota_saida/entrada`, `stg_item_*`, `stg_item_imposto_*` | `gdr_fiscal_documents`, `gdr_fiscal_document_items`, `gdr_fiscal_document_item_taxes` | 11.081 docs, 14.103 itens, 14.103 impostos |
| `t10_vendas_migration.sql` | T10 — Vendas SP | `sp_vendas`, `sp_carretinhas_venda`, `sp_chassis_utilizados` | `gdr_warehouses`, `gdr_sales_orders`, `gdr_sale_items`, `gdr_sale_serial` | 3 WH, 78 pedidos, 195 itens, 1.357 seriais |

## Estado pós-migração (2026-06-18)

Todas as 10 tasks de migração (T1-T10) estão concluídas.

| Tabela | Registros |
|--------|-----------|
| gdr_companies | 4 |
| gdr_products | 310 |
| gdr_bom_versions | 68 |
| gdr_bom_items | 720 |
| gdr_payables | 2.527 |
| gdr_payable_allocations | 2.499 |
| gdr_payment_entries | 1.834 |
| gdr_fiscal_documents | 11.081 |
| gdr_fiscal_document_items | 14.103 |
| gdr_fiscal_document_item_taxes | 14.103 |
| gdr_sales_orders | 78 |
| gdr_sale_items | 195 |
| gdr_sale_serial | 1.357 |

## Próximos passos
- Sincronizar `schema.prisma` local com prefixo `gdr_` e Supabase como datasource
- Implementar módulos NestJS S05-S10 (compras, vendas, fiscal, financeiro, transferência)
