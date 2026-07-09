# UI-SPEC — #496 Expedição pós-NF-e

Stack: igual às outras UIs (Next client · brandbook v2.0 · shadcn/Radix · React Query · `apiClient`).

## Rota & nav
- `apps/web/src/app/app/shipping/page.tsx`. Menu **Comercial**, "Expedição", ícone `PackageCheck`, `FINANCE_ROLES` (= WRITE_ROLES do backend; leituras abertas a autenticado).

## Endpoints
- Entregas: `GET /deliveries?status=` · `PATCH /deliveries/:id/status`.
- Documentos: `GET /vehicle-documents?productId=` · `POST` · `PATCH /:id` · `DELETE /:id` · `POST /:id/deliveries`.
- Pendências: `GET /vehicle-documents/pending-deliveries`.

## Layout — `Tabs [Entregas · Documentos · Pendências]`
- **Entregas:** filtro por status (`Combobox`) + tabela (OV, status badge, transportadora, placa, agendada, entregue) + dialog "Status" (status, transportadora/CNPJ/placa, data agendada, recebido por, notas). Entregas são criadas automaticamente ao faturar — só se atualiza o status aqui.
- **Documentos:** filtro por produto + "Novo documento". Tabela (produto, tipo, nº, emitido, validade, status) com ações: **registrar entrega** (OV, chassi, entregue a Revenda/Cliente final, entregue por), editar, remover.
- **Pendências:** read-only — vendas de veículo faturadas **sem** documento entregue.

## Cores (brandbook)
- Status entrega: AWAITING_BIN `warning`, AWAITING_PICKUP `info`, IN_TRANSIT `brand`, DELIVERED `success`, RETURNED `danger`.
- Status doc: ACTIVE `success`, EXPIRED `warning`, REVOKED `danger`.

## Estados
- loading nas tabelas; erros de mutação inline (`text-danger`) nos dialogs; pendências só carrega ao abrir a aba.

## Aceite (#496 — camada de UI)
1. Painel de entregas com filtro de status e atualização (transportadora/placa/datas). 2. CRUD de documentos regulatórios (CAT/CCT/Projeto Técnico) por produto. 3. Registro de entrega de documento por venda/chassi (revenda/cliente). 4. Dashboard de pendências (vendas sem doc). 5. Menu Comercial guardado.

## Fora de escopo
- Criar/cancelar entrega manualmente (é event-driven); upload real de arquivo (só link).
