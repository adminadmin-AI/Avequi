# Brazil Market Reference

> Context file used by all Finance Squad agents when analyzing Brazilian companies or transactions. Overrides US-market defaults.

---

## Rates & Benchmarks (calibrate annually)

```yaml
risk_free_rate:
  instrument: "Tesouro IPCA+ (NTN-B 10Y)"
  proxy: "CDI / SELIC meta"
  note: "Use NTN-B 10Y for long-duration DCF; CDI for short-term cost of debt"
  typical_range: "5–7% real (IPCA+); 11–14% nominal (2024-2025)"

equity_risk_premium:
  brazil_erp: "EMBI+ Brasil + US ERP base"
  country_risk: "EMBI+ Brasil — typically 150–300bps above US Treasuries"
  total_erp: "10–14% nominal (depending on moment)"
  note: "Damodaran's country risk premium updates at pages.stern.nyu.edu/~adamodar/"

inflation:
  target: "IPCA meta do CMN (atualmente 3% ± 1.5pp)"
  historical_avg: "~5% últimos 10 anos"
  note: "Models in BRL must inflation-adjust. Models in USD use US inflation."

cdi_spread_debt:
  investment_grade_company: "CDI + 100–200bps"
  growth_company: "CDI + 250–450bps"
  distressed: "CDI + 500bps+"
```

---

## Tax Environment

```yaml
corporate_tax:
  irpj: "15% sobre lucro real + adicional 10% acima de R$240K/ano"
  csll: "9% (empresas em geral) / 15% (financeiras)"
  effective_rate: "~34% (IRPJ + CSLL)"
  
regimes_tributarios:
  simples_nacional:
    eligibility: "Faturamento até R$4,8M/ano"
    aliquota: "Varia por setor e faixa (4–22%)"
    note: "Não paga IRPJ/CSLL separado — tudo unificado"
  lucro_presumido:
    eligibility: "Faturamento até R$78M/ano (regra geral)"
    base: "% do faturamento (presunção): 8% comércio, 32% serviços"
    note: "Mais simples, pode ser mais caro que Lucro Real"
  lucro_real:
    eligibility: "Obrigatório acima de R$78M; financeiras; escolha para outros"
    base: "Lucro contábil ajustado"
    note: "Permite aproveitamento de prejuízos fiscais (até 30%/ano)"

jscp:
  name: "Juros sobre Capital Próprio"
  mechanics: "Dedução fiscal sobre PL × TJLP — reduz base tributável como se fosse juros"
  benefit: "Equivale a um tax shield sobre equity — ÚNICO no Brasil"
  tjlp_rate: "Fixada pelo CMN (~7–9% a.a.)"
  note: "Torna a estrutura de capital brasileira diferente do modelo MM clássico — equity tem tax shield também"
  
pis_cofins:
  cumulativo: "Simples/Presumido: 0.65% PIS + 3% COFINS sobre receita"
  nao_cumulativo: "Lucro Real: 1.65% PIS + 7.6% COFINS com crédito de insumos"
```

---

## Capital Markets & Financing Instruments

```yaml
equity:
  ipo_b3: "Exige registro CVM; mínimo histórico ~R$500M mkt cap"
  cvm_instrucao: "CVM 400 (oferta pública) / CVM 476 (esforços restritos, acelerado)"
  investidores_qualificados: "PL > R$1M — acesso a CVM 476"
  
debt_instruments:
  debentures:
    description: "Principal instrumento de dívida corporativa no Brasil"
    tipos:
      simples: "Remuneração CDI+spread ou IPCA+spread"
      conversiveis: "Conversíveis em ações — similar a convertible notes US"
      incentivadas: "Infraestrutura — isenção IR para PF (Lei 12.431)"
    emissores: "S/As; mínimo prático ~R$50M"
  
  cri_cra:
    cri: "Certificado de Recebíveis Imobiliários — lastreado em recebíveis imobiliários"
    cra: "Certificado de Recebíveis do Agronegócio — lastreado em agronegócio"
    beneficio: "Isentos de IR para PF — spreads menores para emissores"
    
  fidc:
    description: "Fundo de Investimento em Direitos Creditórios"
    use_case: "Securitizar recebíveis (duplicatas, cartão, etc.) — antecipação de fluxo"
    cotas: "Sênior (rating, menor risco) + Subordinada (equity, empresa retém)"
    
  bndes:
    description: "Banco Nacional de Desenvolvimento — funding barato"
    taxas: "TLP (Taxa de Longo Prazo) + spread — tipicamente abaixo do mercado"
    programas: ["BNDES Automático", "BNDES Finame (máquinas)", "BNDES Finem (grandes projetos)"]
    prazo: "5–20 anos"
    note: "Custo de capital mais barato que mercado — sempre verificar elegibilidade"
    
  fgts_fii:
    description: "Fundos Imobiliários (FIIs) — veículo para real estate"
    
  cce_nce:
    cce: "Cédula de Crédito à Exportação — para exportadores"
    nce: "Nota de Crédito à Exportação — alternativa"
    beneficio: "Funding externo, sem IOF"
```

---

## M&A Brazilian Context

```yaml
regulacao:
  cade:
    name: "Conselho Administrativo de Defesa Econômica"
    threshold: "Notificação obrigatória: 1 parte com faturamento BR > R$750M E outra > R$75M"
    prazo: "240 dias (prorrogável) — pode ser mais rápido (Rito Sumário: 30 dias)"
    note: "Não pode fechar antes de aprovação (gun-jumping = multa pesada)"
    
  cvm:
    opa: "Oferta Pública de Aquisição — obrigatória para fechamento de capital ou mudança de controle em S/A aberta"
    tag_along: "Acionistas minoritários têm direito a 80% do preço pago ao controlador (Novo Mercado: 100%)"
    
  restricoes_setoriais:
    financeiro: "Aprovação BACEN obrigatória para aquisição de bancos/financeiras"
    saude: "ANS para planos de saúde"
    telecom: "ANATEL"
    energia: "ANEEL"
    aviacao: "ANAC"

estrutura_tipica:
  holding_brasileira: "Comum criar holding para consolidar participações e otimizar tributação"
  juros_capital_proprio: "Holdings podem distribuir JSCP entre subsidiárias — planning fiscal"
  tag_along_novomercado: "100% — proteção máxima para minoritários"
  
multiples_referencia_2024:
  saas_br: "3–8x ARR (vs 5–15x US) — desconto de país e liquidez"
  tech_growth: "4–12x EBITDA NTM"
  varejo: "6–10x EBITDA"
  financeiras: "1.5–3x P/BV"
  note: "Fontes: Distrito, Abstartups, Transação Capital, Bain"
```

---

## Startup Ecosystem BR

```yaml
rounds_tipicos:
  pre_seed: "R$500K – R$2M | Anjos, aceleradoras (Barn, SP Ventures seed)"
  seed: "R$2M – R$10M | Kaszek seed, Monashees, Canary, Maya Capital"
  serie_a: "R$15M – R$60M | Kaszek, Monashees, Valor Capital, SoftBank"
  serie_b_plus: "R$60M+ | SoftBank, Advent, General Atlantic"
  
instrumentos_investimento:
  contrato_de_investimento: "Mais comum que SAFE no BR — direito de subscrição futuro"
  safe_br: "Usado por alguns fundos US-influenced — SAFE padrão YC adaptado"
  nota_conversivel: "Nota conversível com desconto/valuation cap"
  
valuation_startup_br:
  metodologia: "Igual ao US mas com desconto de país (10–20%) e liquidez premium menor"
  exit_multiples_historicos: "3–8x para M&A estratégico; IPO B3 < R$1B é raro"
  wacc_startup: "25–40% (risco BR + risco startup + tamanho)"
  
regulacao_fintechs:
  banco_central: "Licenças: SCD (Sociedade de Crédito Direto), SEP (Correspondente), IP (Instituição de Pagamento)"
  open_finance: "Regulado pelo BACEN — oportunidade para fintechs"
  pix: "PIX + Open Finance muda unit economics de pagamentos"
```

---

## Key Adjustments for Finance Squad Agents

| Framework | US Default | Brasil Adjustment |
|-----------|-----------|-------------------|
| Risk-free rate | 10Y Treasury (~4.5%) | NTN-B 10Y (~6% real / ~11% nominal) |
| ERP | ~5.5% | ~10–14% (inclui country risk) |
| Tax shield | Apenas dívida | **Dívida E equity (JSCP)** |
| Terminal growth | ~2–3% (USD) | IPCA + crescimento real (~5–7% BRL nominal) |
| Debt cost | Prime + spread | CDI + spread |
| DCF currency | USD | BRL (preferível) ou USD com country risk |
| WACC típico | 8–12% | 18–28% (empresa estabelecida BR) |
| WACC startup BR | 15–20% | 25–40% |
