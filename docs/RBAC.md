# RBAC — Matriz de Permissões por Perfil (Frente 3 do hardening de IAM)

> **✅ Matriz validada pelo Rafael em 04/07/2026** (ver seção "Decisões de negócio validadas" no fim).
> O princípio adotado foi: **na dúvida, restringir**. É mais fácil abrir uma permissão
> depois do que descobrir um buraco de segurança em produção.

## Como funciona

- Todos os endpoints exigem **login** (JWT). O que esta matriz define é **quem pode fazer o quê depois de logado**.
- A regra é aplicada pelo decorator `@Roles(...)` nos controllers, verificado pelo `RolesGuard` global.
- **Endpoint sem `@Roles`** = liberado para **qualquer usuário logado** (inclusive READER). Isso é intencional apenas para **leituras não sensíveis**.
- **Importante:** o `RolesGuard` NÃO tem exceção automática para SUPER_ADMIN — se a lista não incluir SUPER_ADMIN, nem ele passa. Por isso SUPER_ADMIN aparece em todas as listas de escrita.

## Os 10 perfis

| Perfil | Papel |
|---|---|
| SUPER_ADMIN | Administrador do sistema — pode tudo |
| DIRECTOR | Diretoria — enxerga tudo (leitura geral), **aprova** e **opera o dia a dia** (produto, estoque, BOM, lançamentos financeiros, venda, compra) |
| MANAGER | Gestor operacional — opera e aprova em quase todos os módulos |
| COMMERCIAL | Vendas — clientes, orçamentos, pedidos de venda, previsão de demanda |
| PRODUCTION | Produção — ordens de produção, BOM, roteiros, MRP, manutenção |
| QUALITY | Qualidade — inspeções, NCR, quarentena/liberação de lotes |
| WAREHOUSE | Almoxarifado — estoque, WMS, transferências, recebimento, compras (solicitação) |
| FINANCIAL | Financeiro — contas a pagar/receber, bancos, fiscal, cobrança |
| STORE | Loja — venda de balcão (pedido + faturamento + cadastro de cliente), transferências entre filiais e solicitações de compra |
| READER | Somente leitura — enxerga dados operacionais, **nunca altera nada** |

## Convenções da matriz

- **Leitura (GET):** "todos" = qualquer usuário logado, inclusive READER.
- **Leitura restrita:** módulos sensíveis (financeiro, bancos, usuários, LGPD, comissões, orçamento empresarial) restringem até a leitura.
- **Escrita (POST/PATCH/DELETE):** somente os perfis listados.
- SUPER_ADMIN está implícito como "pode tudo" — ele consta em todas as listas de escrita.

---

## Matriz por módulo

### Cadastros básicos

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **Produtos** (`/products`) | todos | Criar: SA, DIR, MGR, COM · Editar: SA, DIR, MGR | já existia |
| **Clientes** (`/customers`) | todos | Criar: SA, DIR, MGR, COM, **STO** · Editar: SA, DIR, MGR, COM | STORE cadastra cliente na venda de balcão (04/07) |
| **Fornecedores** (`/suppliers`) | todos | SA, DIR, MGR | já existia |
| **Preços** (`/prices`) | todos | SA, DIR, MGR, COM | já existia |
| **Depósitos** (`/warehouses`) | todos | SA, DIR, MGR | já existia |
| **Empresas** (`/companies`) | todos | SA, DIR | já existia |
| **Usuários** (`/users`) | **SA, DIR, MGR** | SA, DIR, MGR | 🔒 leitura agora restrita (dados de pessoas) |

### Engenharia e Produção

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **BOM** (`/bom`) | todos | Criar: SA, **DIR**, MGR, PRD · Ativar versão: SA, DIR, MGR | DIRECTOR operacional (04/07) |
| **Roteiros** (`/routing`) | todos | Criar/editar: SA, MGR, PRD · Excluir: SA, MGR | |
| **Ordens de Produção** (`/production`) | todos | Criar/liberar/iniciar/concluir/apontar: SA, MGR, PRD · Cancelar: SA, MGR · Aprovar/reprovar inspeção: SA, MGR, QUA | |
| **Sequenciamento** (`/production/schedule`) | todos | Gerar: SA, MGR, PRD | |
| **MRP** (`/mrp`) | todos | Rodar e converter sugestões: SA, MGR, PRD | converter gera PO/OP |
| **Capacidade** (`/capacity`) | todos | Work centers: SA, MGR, PRD · Excluir: SA, MGR | |
| **Manutenção** (`/maintenance`) | todos | Equipamentos e ordens: SA, MGR, PRD · Desativar equipamento / cancelar ordem: SA, MGR | |

### Estoque e Logística

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **Estoque** (`/stock`) | todos | Movimentar: SA, **DIR**, MGR, WHS, PRD · Estornar: SA, MGR | DIRECTOR operacional (04/07); estorno é destrutivo |
| **WMS** (`/wms`) | todos | Endereços, putaway, picking, contagem: SA, MGR, WHS · Reconciliar inventário, ativar/desativar endereço, config WMS, cancelar inventário: SA, MGR | reconciliar ajusta saldo |
| **Transferências** (`/transfers`) | todos | Criar/despachar/receber: SA, MGR, WHS, STO · Cancelar: SA, MGR | STORE participa (filiais) |
| **Lotes** (`/batch`) | todos | Criar: SA, MGR, WHS, PRD, QUA · Consumir: SA, MGR, PRD, WHS · Quarentena/liberar/sucatear: SA, MGR, QUA · Ajustar: SA, MGR, WHS · Checar vencidos: SA, MGR, QUA, WHS | qualidade manda em quarentena |
| **Números de série** (`/serial`) | todos | Criar/editar/vincular: SA, MGR, PRD, WHS · Sucatear: SA, MGR, QUA | |

### Compras

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **Pedidos de compra** (`/purchase`) | todos | Criar/editar PO e recebimento: SA, DIR, MGR, WHS · Aprovar/cancelar PO: SA, DIR, MGR · 3-way match: SA, DIR, MGR, FIN · Resolver divergência: SA, DIR, MGR · Solicitações: SA, DIR, MGR, WHS, STO · **Cancelar solicitação: SA, MGR, WHS, STO (novo)** · Converter em PO: SA, DIR, MGR | já existia em grande parte |
| **RFQ** (`/rfq`) | todos | Criar: SA, DIR, MGR, WHS · **Registrar cotação: SA, MGR, WHS (novo)** · Adjudicar: SA, DIR, MGR | |
| **NF-e de entrada** (`/inbound-nfe`) | todos | Upload/match/rejeitar/importar: SA, MGR, WHS, FIN | importar gera estoque + financeiro |
| **Manifestação destinatário** (`/fiscal/manifest`) | todos | Sincronizar/ciência/confirmar/rejeitar/desconhecer: SA, MGR, FIN | eventos SEFAZ |
| **Portal do fornecedor** (`/supplier-portal`) | Tokens: SA, DIR, MGR | Criar/revogar token: SA, MGR | rotas `me/*` usam token do fornecedor (inalterado) |

### Vendas

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **Vendas** (`/sales`) | todos | Criar/reservar/confirmar: SA, **DIR**, MGR, COM, **STO** · Faturar (emite NF-e): SA, **DIR**, MGR, FIN, **STO** · Devolver/cancelar: SA, MGR | COMMERCIAL não fatura (mantido 04/07); DIRECTOR e STORE operam venda (04/07) |
| **Orçamentos** (`/quotations`) | todos | Criar/editar/enviar/aprovar/rejeitar/converter/expirar: SA, MGR, COM · Excluir: SA, MGR | approve aqui = aceite do cliente registrado por vendas |
| **Previsão de demanda** (`/demand`) | todos | Criar/excluir: SA, MGR, COM · Horizonte MRP: SA, MGR | |
| **Forecast** (`/forecast`) | todos | Gerar/ajustar: SA, MGR, COM | |
| **Comissões** (`/commissions`) | **SA, DIR, MGR, FIN, COM** | Aprovar lote: SA, DIR, FIN · Criar regra: SA, DIR | 🔒 leitura restrita; **COMMERCIAL só vê as próprias comissões e a própria regra** (enforcement no código, 04/07) |

### Fiscal e Tributário

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **Fiscal** (`/fiscal`) | todos | Cancelar NF-e / CC-e / inutilizar faixa: **SA, FIN** · Reprocessar rejeitada: SA, MGR, FIN | webhook continua público (validado por secret) |
| **Regras tributárias** (`/tax-rules`) | SA, DIR, FIN | Criar/editar: SA, DIR, FIN · Excluir: SA, DIR | já existia |
| **Classificações tributárias** (`/tributary-classifications`) | todos | Sincronizar: SA | tabela de referência pública |

### Financeiro (leitura restrita em todo o bloco 🔒)

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **Finance** (`/finance`) | SA, DIR, MGR, FIN | Lançamento manual, pagar, parcelar, cancelar lançamento: **SA, DIR, FIN** · Contas bancárias, categorias, centros de custo (config): **SA, FIN** | DIRECTOR opera lançamentos (04/07); MANAGER só enxerga |
| **Banking** (`/banking`) | SA, DIR, MGR, FIN | Configurar conta, agendar pagamento, boleto, PIX: **SA, FIN** | |
| **Billing** (`/billing`) | SA, DIR, MGR, FIN | Disparar cobrança: **SA, FIN** | |
| **Orçamento empresarial** (`/finance/budget`) | SA, DIR, MGR, FIN | Criar/excluir linha: SA, MGR, FIN | |
| **Dashboard financeiro** (`/dashboard/finance`) | SA, DIR, MGR, FIN | — | demais dashboards: todos |

### Qualidade

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **Qualidade** (`/quality`) | todos | Inspeções (criar/iniciar/aprovar/reprovar/reter) e NCR (criar/editar/analisar/ação corretiva/fechar/cancelar): SA, MGR, QUA | |

### Transversais

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **Aprovações por alçada** (`/approvals`) | SA, DIR, MGR | Aprovar: SA, DIR, MGR | fila de aprovação só para aprovadores |
| **Alertas** (`/alerts`) | todos | Rodar checagem: SA, MGR · Resolver: todos os operacionais (exceto DIR e READER) | |
| **Dashboards** (`/dashboard`) | todos (exceto `finance`) | — | |
| **Relatórios** (`/reports`) | todos | Jobs assíncronos: todos | exportação = leitura |
| **Analytics** (`/analytics`) | todos | — | |
| **LGPD** (`/lgpd`) | **SA, DIR, MGR** | Consentimentos: SA, DIR, MGR · Anonimização: **SA, DIR** | 🔒 dados pessoais de titulares |
| **Rastreamento veicular** (`/vehicle-tracking`) | todos | BIN/ATPV-e: SA, DIR, MGR, FIN | já existia |
| **Auth** (`/auth`) | login/refresh públicos, logout autenticado | — | inalterado |

Legenda: SA = SUPER_ADMIN · DIR = DIRECTOR · MGR = MANAGER · COM = COMMERCIAL · PRD = PRODUCTION · QUA = QUALITY · WHS = WAREHOUSE · FIN = FINANCIAL · STO = STORE.

---

## Decisões de negócio validadas pelo Rafael (04/07/2026)

1. **COMMERCIAL não fatura venda** — MANTIDO. Faturamento (`PATCH /sales/:id/invoice`) segue sem COMMERCIAL.
2. **MANAGER sem escrita no financeiro** — MANTIDO. MANAGER só lê finance/banking/billing.
3. **DIRECTOR volta a operar o dia a dia** — AJUSTADO. DIRECTOR adicionado em: movimentar estoque, criar BOM, lançamentos financeiros (lançar manual, pagar, parcelar, cancelar lançamento — o mesmo operacional de lançamento do FINANCIAL; config bancária/categorias/centros de custo segue SA+FIN), operar venda (criar/reservar/confirmar/faturar). Criar/editar produto e operar compra (PO + solicitações) já incluíam DIRECTOR. Aprovações e leituras mantidas.
4. **Cancelamento fiscal (NF-e / CC-e / inutilização) só SA + FINANCIAL** — MANTIDO (já estava assim).
5. **READER sem leitura financeira** — MANTIDO.
6. **STORE vende e fatura no balcão** — AJUSTADO. STORE ganhou: criar/reservar/confirmar/faturar pedido de venda e criar cliente. Mantidas transferências e solicitações de compra. STORE segue SEM: devolução/cancelamento de venda, aprovações, cancelamento fiscal, financeiro, PO e produção.
7. **Vendedor só vê a própria comissão** — CORRIGIDO NO CÓDIGO. `GET /commissions` e `GET /commissions/rules` forçam filtro pelo usuário logado quando role = COMMERCIAL (o `?userId=` da query é ignorado). Gestores (SA/DIR/MGR/FIN) continuam vendo tudo.
