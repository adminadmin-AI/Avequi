/**
 * Calcula o custo médio ponderado após um recebimento.
 *
 * Fórmula:
 *   novoAvgCost = (saldoAnterior * custoAnterior + qtdeRecebida * custoUnitario)
 *                  / (saldoAnterior + qtdeRecebida)
 *
 * @param prevQty     Quantidade em estoque antes do recebimento (soma de todos os depósitos)
 * @param prevAvgCost Custo médio atual do produto (0 se ainda não há saldo)
 * @param incomingQty Quantidade recebida
 * @param incomingCost Custo unitário da nota/PO recebida
 * @returns Novo custo médio ponderado; retorna 0 se o denominador for zero
 */
export function computeAvgCost(
  prevQty: number,
  prevAvgCost: number,
  incomingQty: number,
  incomingCost: number,
): number {
  const totalQty = prevQty + incomingQty;
  if (totalQty === 0) return 0;
  return (prevQty * prevAvgCost + incomingQty * incomingCost) / totalQty;
}
