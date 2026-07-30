# Importador de Centros de Trabalho (setores da fábrica) — issue #816

## O que é

A GDR Reboques divide a fábrica em **setores produtivos** (Metalúrgica, Solda, Galvanização, Montagem, Expedição etc.). Esses setores vivem hoje na ferramenta interna `producao_v2` (Streamlit + SQL Server local). No ERP, o modelo equivalente é o **`WorkCenter`** (centro de trabalho).

Este importador leva os setores da ferramenta para o ERP de forma **reexecutável e idempotente**: rodar duas vezes seguidas produz o mesmo resultado; rodar depois de uma mudança aplica só o delta. Nada de INSERT manual.

## Fonte dos dados

O ERP **não conecta ao SQL Server** (decisão registrada na issue #816: sem driver no repo, sem secrets novos, e o SQL Server não é alcançável de onde o ERP roda).

A fonte é o arquivo **versionado no repositório**:

```
apps/api/src/modules/production/data/work-centers.data.ts
```

Ele contém apenas dados não sensíveis de cada setor: `code`, `name`, `group`, `type` e `displayOrder`. **Não contém** `companyId`, CNPJ por registro, credenciais, capacidade, custo, operadores ou eficiência.

### Como atualizar o arquivo quando o cadastro mudar

1. Consulte a tabela `Setores_Operacionais` na ferramenta (`SELECT ... ORDER BY OrdemExibicao`).
2. Edite o array `WORK_CENTERS_DATA` no arquivo acima, espelhando a origem — não invente códigos, nomes, tipos nem ordem.
3. Abra PR: o diff do arquivo é a revisão exata do que muda no ERP.
4. Após o merge, reexecute o script (com autorização operacional — ver abaixo).

## Como executar

```bash
# Dry-run (PADRÃO — não grava nada, só imprime o plano)
npx tsx apps/api/scripts/import-work-centers.ts

# Gravar criações e atualizações
npx tsx apps/api/scripts/import-work-centers.ts --apply

# Também desativar centros que sumiram do arquivo (nunca exclui)
npx tsx apps/api/scripts/import-work-centers.ts --apply --deactivate-missing

# --deactivate-missing SEM --apply continua sendo dry-run: só mostra, no plano,
# quais ausentes SERIAM desativados — nada é gravado
npx tsx apps/api/scripts/import-work-centers.ts --deactivate-missing

# Apontar outra empresa (CNPJ com igualdade EXATA, 14 dígitos)
TARGET_COMPANY_CNPJ=00000000000000 npx tsx apps/api/scripts/import-work-centers.ts
```

O banco alvo é o da conexão Prisma do ambiente (`DATABASE_URL`). O script **nunca imprime** a URL nem credenciais, inclusive em erro.

> ⚠️ **Executar com `--apply` em qualquer ambiente do ERP é uma etapa operacional separada e exige autorização específica.** A entrega da issue #816 é só o código: arquivo de dados, script, testes e esta documentação.

## O que o script administra — e o que ele nunca toca

| Campo | Comportamento |
|---|---|
| `code` | Chave natural do upsert (junto com a empresa). Nunca alterado. |
| `name` | Administrado — atualizado se divergir do arquivo. |
| `description` | Administrado — sempre `"Grupo · Tipo"` (ex.: `Metalúrgica · Producao`). |
| `isActive` | Administrado — derivado do tipo (tabela abaixo). |
| `capacityHoursPerDay` | **Nunca sobrescrito.** Na criação fica no default do schema (8). |
| `costPerHour` | **Nunca sobrescrito.** Default 0. |
| `operatorsCount` | **Nunca sobrescrito.** Default 1. |
| `efficiencyPct` | **Nunca sobrescrito.** Default 85. |

Os quatro últimos serão levantados pela operação da fábrica futuramente (issue própria); o importador não pode apagar o que a operação ajustar.

### Regra de atividade por tipo

| Tipo na origem | `isActive` | Exemplo |
|---|---|---|
| `Producao` | ✅ ativo | Corte, Solda 1, Montagem de Chassi |
| `Opcional` | ✅ ativo | Pintura EPOX a pó |
| `Estoque` | ❌ inativo | os 8 `SET-MER-*` (mercados/almoxarifado) |
| `Apoio` | ❌ inativo | Administrativo, Diretoria, Refeitório |

Os 11 não produtivos são importados mesmo assim (código resolvível em dado histórico), mas inativos — não poluem despacho nem capacidade.

## Empresa de destino

- Padrão: **GDR Reboques, CNPJ `46247069000115`**, sobrescritível por `TARGET_COMPANY_CNPJ`.
- Busca por **igualdade exata** — nunca `contains` (o precedente com `contains('46247069')` casaria também com a GDR Guarapuava `46247069000204`).
- **0 empresas → aborta. Mais de 1 → aborta.** Nunca "a primeira encontrada".
- `companyId` **nunca** vem do arquivo de dados — só da empresa resolvida.

## Relatório e política para ausentes

Todo run imprime o plano em quatro categorias:

| Categoria | Significado | Ação com `--apply` |
|---|---|---|
| **criados** | no arquivo, não no ERP | cria |
| **atualizados** | nos dois, com diferença em campo administrado | atualiza só o que mudou |
| **inalterados** | nos dois, idênticos | nada |
| **ausentes** | no ERP, fora do arquivo | **só relata**; desativa apenas com `--deactivate-missing`; **nunca exclui** |

As escritas do `--apply` rodam numa única transação — nunca fica plano meio aplicado.

## Testes

```bash
cd apps/api && npx jest work-center-import
```

Lógica extraída para funções puras em `apps/api/src/common/production/work-center-import.ts` (o CLI é só adaptador). Cobrem: classificação das 4 categorias, idempotência, dry-run sem nenhuma escrita, campos operacionais intocados, regra de atividade por tipo, resolução da empresa (0/1/>1), ausentes (relatar/desativar/nunca excluir) e sanidade do arquivo de dados (34 setores, 11 inativos, codes únicos).
