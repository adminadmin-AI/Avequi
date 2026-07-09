---
name: reforma-tributaria
description: >-
  Parametrização fiscal da Reforma Tributária (IBS/CBS/IS, LC 214/2025, NT
  2025.002-RTC) para o ERP Avequi. Classifica produtos e monta as regras
  fiscais (cClassTrib, CST IBS/CBS, CST ICMS/PIS/COFINS/IPI, CFOP por operação),
  gerando um RELATÓRIO fundamentado para o contador/tributarista validar e
  assinar. Use ao classificar produtos, preencher campos da reforma, montar
  TaxRules, ou revisar parametrização fiscal. NÃO substitui o contador — propõe,
  ele dispõe.
---

# Reforma Tributária — Parametrização Fiscal (Avequi ERP)

## Objetivo
Acelerar a parametrização fiscal (foco na Reforma Tributária do consumo) produzindo
um **rascunho fundamentado por produto**, que um contador/tributarista **revisa e assina**.
A skill faz o trabalho braçal (classificar, padronizar, documentar, preencher o ERP);
a decisão final que vai pra NF-e é sempre humana.

## ⏰ Contexto de prazo (verificar sempre a data)
IBS/CBS **obrigatório em produção em 03/08/2026 para CRT=3** (Lucro Real/Presumido — caso da GDR).
Sem `cClassTrib`/CST IBS-CBS corretos, a NF-e é rejeitada (regras N12-110/LA, rejeições 960/1106).
Simples/MEI têm prazo estendido (04/01/2027). Confirmar o CRT da empresa antes.

## 🔒 Disciplina de fundamentação (NÃO NEGOCIÁVEL — é o que evita malha/autuação)
1. **Fonte de verdade dos códigos `cClassTrib` = tabela `TributaryClassification` do banco** (164 códigos oficiais carregados), NÃO a memória do modelo. Consultar sempre:
   ```
   cd apps/api && node --env-file=.env -e 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();p.tributaryClassification.findMany({where:{cst:"200"}}).then(r=>{console.log(JSON.stringify(r,null,1));p.$disconnect()})'
   ```
2. **NUNCA inventar um código.** Se o produto não casar com nenhum código do catálogo, marcar `INDEFINIDO → precisa contador`, nunca chutar um plausível (código errado que passa na emissão = pior caso, cai na malha depois).
3. **Cada classificação carrega fonte legal** (artigo da LC 214/2025 / NT 2025.002-RTC / tabela oficial). Ver `references/reforma-2026.md` e `references/fontes-oficiais.md`.
4. **Fatos da empresa não são inferíveis** — regime tributário, benefícios/TTD estaduais, regimes especiais, decisões judiciais: pedir a documentação. Sem isso, marcar como premissa a validar.
5. **Toda saída leva `confiança` (alta/média/baixa) + `revisar_contador` (sim/não).** Borda = baixa + sim.

## Entradas
- **Do ERP (já disponível):** produtos (`/products`: sku, name, ncm, cClassTrib, origem, cest, type), catálogo `cClassTrib` (164), TaxRules existentes (43), operações (`TaxOperationType`).
- **Do usuário (pedir):** cartão CNPJ das filiais + **CRT/regime**, UF de cada filial, **benefícios/TTD** (ex.: PR), CFOP/CST usados hoje, pareceres do contador, natureza real de cada família de produto.

## Processo (por produto)
1. **NCM** — confirmar/validar (reboques ≈ 8716.xx). NCM define muito da tributação; NCM errado contamina tudo.
2. **cClassTrib** — casar a natureza do produto/operação com um código do catálogo (`TributaryClassification`). Regra geral tributada = `000001` (CST 000). Reduções/isenções/imunidades/monofásico → código específico (CST 2xx/4xx/5xx/8xx). Registrar o CST IBS/CBS que o código carrega.
3. **ICMS/IPI/PIS/COFINS** — CST + alíquota + CFOP por **operação** (`TaxOperationType`): venda interna/interestadual, **transferência interna/interestadual**, devolução, etc. Reusar `TaxRule` existente quando houver.
4. **Vigência** — usar `validFrom/validTo` da TaxRule para a transição (2026 teste CBS 0,9% / IBS 0,1% → 2027 CBS pleno → 2029-33 ICMS→IBS). NT nova = linha nova com `validFrom` futuro (é carga de dado, não deploy).
5. **Saída** — preencher o relatório (template abaixo) e, quando aprovado pelo contador, gerar as linhas de `TaxRule`/`Product.cClassTrib` prontas pra importar.

## Saída — Relatório
Usar `references/classificacao-report-template.md`. Uma linha por produto × operação, com: valor proposto, fonte legal, confiança, flag de revisão. Ao fim: resumo de cobertura (quantos classificados / indefinidos / precisam contador) e as pendências de documentação.

## O que esta skill NÃO faz
- Não gera SPED/EFD (é da contabilidade).
- Não aplica nada direto na NF-e sem passar pelo relatório + aval do contador.
- Não decide benefício fiscal/regime especial sem a documentação da empresa.

## Fluxo recomendado
1. Puxar produtos + catálogo + TaxRules do banco.
2. Pedir a documentação da empresa (checklist em `references/fontes-oficiais.md`).
3. Classificar por família de produto (consistência: mesma família → mesma classificação).
4. Gerar relatório → contador valida/assina → importar as TaxRules aprovadas.
