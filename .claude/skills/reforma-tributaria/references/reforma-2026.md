# Reforma Tributária — framework de referência (atualizado 2026-07-09)

> Esta base é atualizada pela rotina semanal (ver `fontes-oficiais.md`). Sempre
> conferir a versão vigente da NT no Portal da NF-e antes de decidir.

## Os tributos novos
- **CBS** (federal) — substitui PIS/COFINS (e parte do IPI). Não-cumulativa.
- **IBS** (estadual + municipal) — substitui ICMS + ISS. Não-cumulativa.
- **IS** (Imposto Seletivo) — "imposto do pecado" (produtos nocivos). Reboque não incide, mas checar insumos.
- Base legal: **EC 132/2023** + **LC 214/2025**. Cada CST/cClassTrib mapeia um artigo da LC 214.

## Linha do tempo da transição (crítico p/ `validFrom`/`validTo` das TaxRules)
| Período | O que vale |
|---|---|
| **2026** | Ano-teste: **CBS 0,9%** + **IBS 0,1%** (compensáveis com PIS/COFINS). NF-e já com grupo IBS/CBS. |
| **03/08/2026** | IBS/CBS **obrigatório em produção** para **CRT=3** (Lucro Real/Presumido). ⬅️ prazo GDR |
| **04/01/2027** | Prazo estendido p/ Simples/MEI. |
| **2027** | CBS em alíquota plena; extinção de PIS/COFINS; IPI zerado (salvo ZFM). |
| **2029–2032** | Transição gradual ICMS→IBS (proporções crescentes de IBS, decrescentes de ICMS). |
| **2033** | Regime pleno IBS/CBS; ICMS/ISS extintos. |

## NF-e / NFC-e — NT 2025.002-RTC
- Adiciona o **grupo IBSCBS** por item (model 55/65). Versão vigem citada: **1.33** (confirmar no portal).
- Campos-chave por item: **`cClassTrib`** (6 díg.), CST IBS/CBS (3 díg.), grupos de valor (vBC, alíquotas UF/Mun/CBS, vIBS, vCBS), grupos de redução (`gRed`) e monofásico (grupo UB, 5 frentes).
- **Regras de validação** amarradas ao `cClassTrib`: famílias **LA01-30** e **N12-110**; rejeições **1106** e **960** (dados obrigatórios ausentes/incoerentes).
- Jan/2026: regra **UB12-10** (obrigatoriedade) foi **adiada** → sem rejeição por ausência de IBS/CBS no início; **mas a obrigação tributária existe** e a obrigatoriedade técnica entra em produção em 03/08/2026 (CRT=3).

## Estrutura de CST IBS/CBS × cClassTrib (o que está no catálogo do banco — 164 códigos)
CSTs presentes (contagem no catálogo GDR):
- **000** (5) — tributação integral (código geral `000001`).
- **200** (54) — reduções de alíquota (a maior família — muita coisa cai aqui).
- **220/221/222** — reduções específicas.
- **400** (2) — isenção · **410** (38) — imunidade.
- **510/515/550** — diferimento / suspensão.
- **620** — crédito presumido.
- **800/810/811/820/830** — monofásico e regimes específicos.

> Regra prática: produto **tributado normal → `000001` (CST 000)**. Só sai disso com base legal (redução/isenção/imunidade/monofásico) documentada. Na dúvida → `INDEFINIDO / revisar contador`.

## Pegadinhas conhecidas
- **NCM errado** contamina cClassTrib e alíquota — validar primeiro.
- **Transferência entre estabelecimentos do mesmo titular:** ver ADC 49 / LC 204/2023 (ICMS **não incide**; transferência de crédito facultativa). No IBS/CBS a transferência tem tratamento próprio — confirmar na LC 214.
- Alíquotas de teste 2026 (0,9 / 0,1) mudam em 2027 → usar **vigência temporal** na TaxRule, nunca hardcode.

## Fontes (2026-07-09)
- Portal NF-e — NT 2025.002-RTC: https://www.nfe.fazenda.gov.br
- Receita Federal — Orientações 2026: https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-consumo/orientacoes-2026
- LC 214/2025 (Planalto).
