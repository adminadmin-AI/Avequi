# SPEC — Transferência de mercadoria entre filiais (matriz → filial)

Épico relacionado: #496 (expedição) · precedente: #628 (chassi na transferência) · #364/#365 (docs/entrega).

## Problema
As filiais da GDR (PR, SC, RS, SP, MG) são **`companyId` distintos** (multi-tenant por CNPJ). O
`StoreTransfer` atual só move mercadoria **entre depósitos do MESMO `companyId`** (`fromWarehouseId`→
`toWarehouseId`, ambos sob o `companyId` do JWT). Logo:
- **Não modela transferência entre filiais** (companyIds diferentes) — hoje é impossível como um único fluxo.
- `emitForTransfer` está **chumbado em `TRANSFERENCIA_INTERNA`** → não trata interestadual (matriz PR → filial SP/SC/RS/MG).
- **0 transferências** já feitas em prod → fluxo nunca exercido.

## Enquadramento fiscal (a confirmar com contador)
- Transferência entre estabelecimentos **do mesmo titular** (mesma raiz CNPJ 46247069) exige **NF-e de transferência** (obrigação acessória), CFOP **5152** (interna) / **6152** (interestadual).
- **ICMS — ADC 49 (STF) / LC 204/2023:** **não incidência** na transferência do mesmo titular; **transferência de crédito facultativa** (opção do contribuinte). O destaque depende dessa opção → **decisão do contador**, refletida na `TaxRule`, não no código.
- **IBS/CBS (reforma):** transferência tem tratamento próprio na LC 214 — parametrizar via `TaxRule` com `cClassTrib` adequado e vigência (ver skill `reforma-tributaria`).

## Princípio de design
Modelar a transferência inter-filial **como ela é no fisco**: **saída** (NF-e de transferência na origem) +
**entrada** (NF-e de entrada no destino). Reusar o que já existe: `emitForTransfer`, módulo `inbound-nfe`,
chassi (#628), `TaxRule` de `TRANSFERENCIA_*`.

## Decisões (confirmar antes de codar)
1. **Entidade nova `InterBranchTransfer`** (recomendado) vs estender `StoreTransfer`. → **Nova**, pra não
   quebrar o intra-company que já funciona e por cruzar dois `companyId`.
2. **ICMS na transferência** — destacar transferência de crédito ou não (opção do contribuinte pós-LC204). → **contador**.
3. UFs por filial (já informado: PR, SC, RS, SP, MG) → derivar interna/interestadual pela UF origem×destino.

## Modelagem
```
model InterBranchTransfer {
  id                String   @id @default(cuid())
  originCompanyId   String   // filial de origem (emite a NF-e de saída)
  destCompanyId     String   // filial de destino (recebe como entrada)
  originWarehouseId String
  destWarehouseId   String
  status            InterBranchTransferStatus @default(DRAFT) // DRAFT→DISPATCHED→IN_TRANSIT→RECEIVED / CANCELLED
  outboundFiscalDocumentId String?   // NF-e de saída (origem)
  inboundNfeId             String?   // registro de entrada (destino)
  items             InterBranchTransferItem[]  // productId, quantidade, serialNumberId? (chassi)
  ...
  @@index([originCompanyId]) @@index([destCompanyId]) @@index([status])
}
```
Validação: `originCompanyId` e `destCompanyId` devem ser **filiais do mesmo titular** (mesma raiz CNPJ).

## Fluxo
1. **Criar** (DRAFT): usuário da origem monta a transferência (produtos, chassi se aplicável).
2. **Despachar** (DISPATCHED): deriva `TRANSFERENCIA_INTERNA` vs `INTERESTADUAL` das UFs → `emitForTransfer`
   adaptado emite a **NF-e de saída** na origem (CFOP 5152/6152, impostos pela `TaxRule` vigente). Reserva/baixa estoque origem; chassi → `IN_TRANSIT` (reuso #628).
3. **Autorizada** → **cria automaticamente o registro de entrada** no destino via módulo `inbound-nfe`
   (a NF-e de saída da origem é a NF-e de entrada do destino). Estoque do destino aguarda recebimento.
4. **Receber** (RECEIVED): confirma entrada no destino → dá entrada no estoque do `destCompanyId`; chassi → estoque destino.
5. **Cancelar**: se antes de autorizar/receber (respeitando prazo SEFAZ 24h da NF-e).

## Serviço cross-tenant (guarda)
- Um `InterBranchTransferService` autorizado a escrever nos **dois** `companyId` **só neste fluxo**,
  com permissão dedicada (`stock.interbranch.dispatch` / `.receive`) e **auditoria** em ambas as pontas.
  O isolamento multi-tenant do resto do sistema permanece intacto.

## Correções necessárias
- `emitForTransfer`: **derivar** `TRANSFERENCIA_INTERNA`/`INTERESTADUAL` das UFs (hoje chumbado). Bug pré-existente.
- Garantir CFOP correto por sentido (5152/6152) e o enquadramento ICMS pós-LC204 vindo da `TaxRule`.

## UI
Tela de transferência inter-filial (origem/destino filial, produtos, chassi, acompanhamento **saída autorizada → entrada recebida**),
no menu Estoque/Expedição. Brandbook v2.0.

## Fases
1. Schema `InterBranchTransfer(+Item)` + enum + migração aditiva (Supabase).
2. Serviço cross-tenant + guarda/permissões + validação mesma-raiz-CNPJ.
3. Emissão de saída (adaptar `emitForTransfer` + fix INTERNA/INTERESTADUAL) + `TaxRule` de transferência.
4. Entrada automática no destino (integra `inbound-nfe`) + recebimento + estoque.
5. Chassi inter-filial (estende #628).
6. UI + testes (jest) + build.
7. Deploy (tabelas no Supabase antes; bump de versão).

## Fora de escopo
- Transferência entre titulares diferentes (aí é venda/remessa, outro fluxo).
- Geração de SPED (contabilidade).
- Otimização de rota/logística.

## Estimativa
Porte **médio** — reaproveita emissão, inbound-nfe, chassi e TaxRules. O trabalho novo é o **orquestrador
cross-tenant** e a **entrada automática no destino**. Parametrização fiscal da transferência = skill + contador.
