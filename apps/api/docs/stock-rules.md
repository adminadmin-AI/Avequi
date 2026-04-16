# Regras de Estoque — GDR ERP

## Imutabilidade dos movimentos
StockMovement é append-only. Nunca editar ou deletar. Erros se corrigem via REVERSAL.

## Como estornar
POST /stock/reverse/:movementId com { reason }. Cria movimento REVERSAL que desfaz o saldo.

## Proteção contra saldo negativo
Saídas (EXIT, TRANSFER_OUT) são bloqueadas se available < quantity. Erro informa saldo disponível.

## Transações
Todo write em StockBalance usa prisma.$transaction para evitar race conditions.

## Tipos de movimento
| Tipo | Efeito | Uso |
|------|--------|-----|
| ENTRY | +qty | Entrada manual, recebimento |
| EXIT | -qty | Saída manual, expedição |
| ADJUSTMENT | +/-qty | Ajuste de inventário |
| REVERSAL | inverso | Estorno |
| TRANSFER_OUT | -qty | Saída p/ outro depósito |
| TRANSFER_IN | +qty | Entrada de outro depósito |
