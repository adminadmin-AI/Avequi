# Importador de Centros de Trabalho

> ⚠️ **O merge do PR não autoriza nem executa a importação. A execução com `--apply` em qualquer ambiente do ERP exige autorização operacional separada.**

Este documento tem duas partes: o **mecanismo genérico** (produto, vale para qualquer empresa) e a **carga da GDR Reboques** (implantação específica).

---

## Parte 1 — Mecanismo genérico

### O que é

Um núcleo reutilizável de sincronização de centros de trabalho (`WorkCenter`), em:

```
apps/api/src/common/production/work-center-import.ts
```

Ele compara um **estado final desejado** com o que existe no banco e aplica só o delta, de forma **idempotente** (chave natural: `companyId` + `code`). Não conhece nenhuma empresa, CNPJ, taxonomia de origem ou regra de implantação — tudo isso chega de fora.

### Formato de entrada

```ts
interface DesiredWorkCenter {
  code: string;          // chave natural — nunca alterado
  name: string;
  description: string | null;
  isActive: boolean;     // decisão já tomada pela implantação
}
```

### Comportamento

| Aspecto | Regra |
|---|---|
| Dry-run | Decisão do chamador (`apply: false`): monta e devolve o plano completo, **nenhuma escrita** |
| Apply | Cria e atualiza dentro de **uma transação** — nunca fica plano meio aplicado |
| Campos administrados | Somente `name`, `description`, `isActive`. Um registro só é "atualizado" se um deles divergir |
| Campos protegidos | Qualquer outro campo do `WorkCenter` (`capacityHoursPerDay`, `costPerHour`, `operatorsCount`, `efficiencyPct`, …) **nunca é gravado nem sobrescrito** — na criação ficam nos defaults do schema |
| Ausentes | No banco, fora do dataset: **só relatados**; desativados apenas com `deactivateMissing` explícito (e só os ativos); **não existe caminho de exclusão** |
| Relatório | Plano em 4 categorias: criados / atualizados / inalterados / ausentes |
| Empresa | CNPJ **obrigatório** (o núcleo não tem empresa padrão), busca por **igualdade exata** — nunca `contains`; 0 resultados → aborta; mais de 1 → aborta; `companyId` **nunca** vem do dataset |

### Como outra empresa usa

Sem tocar no núcleo, seus tipos, suas regras ou seus testes:

1. Cria seu próprio arquivo de dados, já no formato final `DesiredWorkCenter[]` — com seus códigos, descrições e **sua própria decisão** de `isActive` (a política da GDR não se aplica);
2. Cria um wrapper CLI próprio (~30 linhas — espelhar `import-work-centers-gdr.ts`), informando **explicitamente** o CNPJ da sua empresa;
3. Reutiliza `runWorkCenterImport` com as mesmas garantias (dry-run, transação, ausentes, campos protegidos).

---

## Parte 2 — Carga da GDR Reboques

### O que é

A implantação da GDR: os **34 setores da fábrica** cadastrados na ferramenta interna `producao_v2` (Streamlit + SQL Server local), levados ao ERP pelo CLI:

```
apps/api/scripts/import-work-centers-gdr.ts
```

O dataset e as regras da GDR vivem em:

```
apps/api/src/modules/production/data/gdr/work-centers.data.ts
```

### Fonte dos dados

- Tabela **`Setores_Operacionais`** do SQL Server local — **34 registros** (extração manual conferida em 29/07/2026).
- O seed antigo da ferramenta (`criar_setores_operacionais.py`) tem só **29 registros e está desatualizado** — a tabela viva é a fonte.
- **O ERP não conecta ao SQL Server** (sem driver no repo, sem secrets novos, SQL Server inalcançável de onde o ERP roda). O arquivo versionado é a fonte; o diff dele no PR é a revisão exata do que muda.

O arquivo contém apenas `code`, `name`, `group`, `type` e `displayOrder` por setor — **sem** `companyId`, CNPJ por registro, credenciais ou campos operacionais.

### Regras DESTA implantação (não do produto)

- **`description`** = `"Grupo · Tipo"` (ex.: `Metalúrgica · Producao`);
- **`isActive` por tipo da origem**:

| Tipo | `isActive` | Exemplo |
|---|---|---|
| `Producao` | ✅ ativo | Corte, Solda 1, Montagem de Chassi |
| `Opcional` | ✅ ativo | Pintura EPOX a pó |
| `Estoque` | ❌ inativo | os 8 `SET-MER-*` (mercados/almoxarifado) |
| `Apoio` | ❌ inativo | Administrativo, Diretoria, Refeitório |

Resultado: **23 ativos e 11 inativos**. Os não produtivos entram mesmo assim (código resolvível em dado histórico) mas inativos — não poluem despacho nem capacidade. Os campos operacionais (capacidade, custo/hora, operadores, eficiência) serão levantados pela fábrica em issue própria; o importador nunca os toca.

### Empresa de destino

Padrão do wrapper: **GDR Reboques, CNPJ `46247069000115`** (legítimo aqui — o nome do comando diz que é carga GDR; o núcleo genérico não tem empresa padrão). Sobrescrita administrativa: `TARGET_COMPANY_CNPJ`. A busca é por igualdade exata — o precedente com `contains('46247069')` casaria também com a GDR Guarapuava `46247069000204`.

### Como executar

```bash
# Dry-run (PADRÃO — não grava nada, só imprime o plano)
npx tsx apps/api/scripts/import-work-centers-gdr.ts

# Gravar criações e atualizações
npx tsx apps/api/scripts/import-work-centers-gdr.ts --apply

# Também desativar centros que sumiram do dataset (nunca exclui)
npx tsx apps/api/scripts/import-work-centers-gdr.ts --apply --deactivate-missing

# --deactivate-missing SEM --apply continua sendo dry-run: só mostra, no plano,
# quais ausentes SERIAM desativados — nada é gravado
npx tsx apps/api/scripts/import-work-centers-gdr.ts --deactivate-missing

# Apontar outra empresa (CNPJ com igualdade EXATA, 14 dígitos)
TARGET_COMPANY_CNPJ=00000000000000 npx tsx apps/api/scripts/import-work-centers-gdr.ts
```

O banco alvo é o da conexão Prisma do ambiente (`DATABASE_URL`). O script **nunca imprime** a URL nem credenciais, inclusive em erro. Flag desconhecida é rejeitada antes de tocar o banco.

### Como atualizar o dataset quando a ferramenta mudar

1. Consulte a tabela `Setores_Operacionais` (`SELECT ... ORDER BY OrdemExibicao`);
2. Edite `GDR_WORK_CENTER_SOURCE` no arquivo do dataset, espelhando a origem — não invente códigos, nomes, tipos nem ordem;
3. Abra PR — o diff é a revisão;
4. Após o merge, reexecute o CLI (com autorização operacional).

## Testes

```bash
cd apps/api && npx jest work-center
```

- **Núcleo** (`src/common/production/work-center-import.spec.ts`): dados 100% sintéticos — classificação, dry-run sem escrita, apply transacional, idempotência, campos protegidos, ausentes, resolução da empresa (0/1/>1, CNPJ obrigatório).
- **Dataset GDR** (`src/modules/production/data/gdr/work-centers.data.spec.ts`): 34 registros, codes únicos, ordem 1..34, 23 ativos/11 inativos, EPX ativo, descriptions derivadas, sem companyId/credenciais, CNPJ da GDR só no adaptador.
