# RBAC — Matriz de Permissões por Perfil (Frente 3 do hardening de IAM)

> **⚠️ Esta matriz é uma PROPOSTA técnica e precisa de validação de negócio do Rafael.**
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
| DIRECTOR | Diretoria — enxerga tudo (leitura geral) e **aprova**, mas não opera o dia-a-dia |
| MANAGER | Gestor operacional — opera e aprova em quase todos os módulos |
| COMMERCIAL | Vendas — clientes, orçamentos, pedidos de venda, previsão de demanda |
| PRODUCTION | Produção — ordens de produção, BOM, roteiros, MRP, manutenção |
| QUALITY | Qualidade — inspeções, NCR, quarentena/liberação de lotes |
| WAREHOUSE | Almoxarifado — estoque, WMS, transferências, recebimento, compras (solicitação) |
| FINANCIAL | Financeiro — contas a pagar/receber, bancos, fiscal, cobrança |
| STORE | Loja — transferências entre filiais e solicitações de compra |
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
| **Clientes** (`/customers`) | todos | SA, DIR, MGR, COM | já existia |
| **Fornecedores** (`/suppliers`) | todos | SA, DIR, MGR | já existia |
| **Preços** (`/prices`) | todos | SA, DIR, MGR, COM | já existia |
| **Depósitos** (`/warehouses`) | todos | SA, DIR, MGR | já existia |
| **Empresas** (`/companies`) | todos | SA, DIR | já existia |
| **Usuários** (`/users`) | **SA, DIR, MGR** | SA, DIR, MGR | 🔒 leitura agora restrita (dados de pessoas) |

### Engenharia e Produção

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **BOM** (`/bom`) | todos | Criar: SA, MGR, PRD · Ativar versão: SA, DIR, MGR | ativar = aprovação (DIRECTOR entra) |
| **Roteiros** (`/routing`) | todos | Criar/editar: SA, MGR, PRD · Excluir: SA, MGR | |
| **Ordens de Produção** (`/production`) | todos | Criar/liberar/iniciar/concluir/apontar: SA, MGR, PRD · Cancelar: SA, MGR · Aprovar/reprovar inspeção: SA, MGR, QUA | |
| **Sequenciamento** (`/production/schedule`) | todos | Gerar: SA, MGR, PRD | |
| **MRP** (`/mrp`) | todos | Rodar e converter sugestões: SA, MGR, PRD | converter gera PO/OP |
| **Capacidade** (`/capacity`) | todos | Work centers: SA, MGR, PRD · Excluir: SA, MGR | |
| **Manutenção** (`/maintenance`) | todos | Equipamentos e ordens: SA, MGR, PRD · Desativar equipamento / cancelar ordem: SA, MGR | |

### Estoque e Logística

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **Estoque** (`/stock`) | todos | Movimentar: SA, MGR, WHS, PRD · Estornar: SA, MGR | estorno é destrutivo |
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
| **Vendas** (`/sales`) | todos | Criar/reservar/confirmar: SA, MGR, COM · **Faturar (emite NF-e): SA, MGR, FIN** · Devolver/cancelar: SA, MGR | ⚠️ faturamento tirado do COMMERCIAL — validar |
| **Orçamentos** (`/quotations`) | todos | Criar/editar/enviar/aprovar/rejeitar/converter/expirar: SA, MGR, COM · Excluir: SA, MGR | approve aqui = aceite do cliente registrado por vendas |
| **Previsão de demanda** (`/demand`) | todos | Criar/excluir: SA, MGR, COM · Horizonte MRP: SA, MGR | |
| **Forecast** (`/forecast`) | todos | Gerar/ajustar: SA, MGR, COM | |
| **Comissões** (`/commissions`) | **SA, DIR, MGR, FIN, COM** | Aprovar lote: SA, DIR, FIN · Criar regra: SA, DIR | 🔒 leitura agora restrita (valores de comissão) |

### Fiscal e Tributário

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **Fiscal** (`/fiscal`) | todos | Cancelar NF-e / CC-e / inutilizar faixa: **SA, FIN** · Reprocessar rejeitada: SA, MGR, FIN | webhook continua público (validado por secret) |
| **Regras tributárias** (`/tax-rules`) | SA, DIR, FIN | Criar/editar: SA, DIR, FIN · Excluir: SA, DIR | já existia |
| **Classificações tributárias** (`/tributary-classifications`) | todos | Sincronizar: SA | tabela de referência pública |

### Financeiro (leitura restrita em todo o bloco 🔒)

| Módulo / Endpoint | Leitura | Escrita | Observação |
|---|---|---|---|
| **Finance** (`/finance`) | SA, DIR, MGR, FIN | Lançamento manual, pagar, parcelar, cancelar, contas bancárias, categorias, centros de custo: **SA, FIN** | DIRECTOR/MANAGER só enxergam |
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

## Pontos que MAIS precisam de validação de negócio

1. **Faturar venda (`PATCH /sales/:id/invoice`)** — proposto SA, MGR, FIN. O vendedor (COMMERCIAL) **não** fatura mais. Se na GDR o próprio vendedor emite a NF-e, incluir COMMERCIAL.
2. **Financeiro só para FINANCIAL** — MANAGER perdeu escrita em finance/banking/billing (só lê). Se o gerente paga contas hoje, incluir MANAGER nas escritas.
3. **DIRECTOR sem operação do dia-a-dia** — DIRECTOR foi removido de criações operacionais (BOM, estoque, vendas etc.), mantendo leitura geral e aprovações (PO, alçada, BOM activate, tax-rules). Confirmar se algum diretor opera na prática.
4. **Leitura de comissões** restrita a SA, DIR, MGR, FIN, COM — vendedor vê a própria? (hoje o filtro por usuário é só query param, sem enforcement).
5. **READER** ficou sem acesso a: finance, banking, billing, budget, commissions, users, lgpd, approvals/pending, dashboard/finance. Confirmar se o perfil READER da GDR precisa ver financeiro.
6. **Cancelamento fiscal (NF-e) só SA e FIN** — nem MANAGER cancela NF-e. Ação com prazo legal de 24h; confirmar quem faz isso hoje.
7. **STORE** só participa de transferências e solicitações de compra. Se a loja emite NFC-e/vende, precisará de mais permissões.
