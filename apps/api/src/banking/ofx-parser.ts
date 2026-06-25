/**
 * Simple OFX parser — extracts transactions from OFX/QFX bank statement files.
 * Handles SGML-style OFX (most Brazilian banks).
 */
export interface OfxTransaction {
  fitId: string;
  type: 'DEBIT' | 'CREDIT';
  date: Date;
  amount: number;
  description: string;
  reference?: string;
}

export function parseOfx(content: string): OfxTransaction[] {
  const transactions: OfxTransaction[] = [];

  // Extract STMTTRN blocks
  const trnBlocks = content.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) ?? [];

  for (const block of trnBlocks) {
    const extract = (tag: string): string => {
      const m = block.match(new RegExp(`<${tag}>([^<\\n]+)`, 'i'));
      return m ? m[1].trim() : '';
    };

    const trnType = extract('TRNTYPE');
    const dtPosted = extract('DTPOSTED');
    const trnAmt = extract('TRNAMT');
    const fitId = extract('FITID');
    const memo = extract('MEMO');
    const name = extract('NAME');
    const checkNum = extract('CHECKNUM');

    if (!fitId || !trnAmt) continue;

    const amount = parseFloat(trnAmt.replace(',', '.'));
    const year = dtPosted.substring(0, 4);
    const month = dtPosted.substring(4, 6);
    const day = dtPosted.substring(6, 8);
    const date = new Date(`${year}-${month}-${day}`);

    transactions.push({
      fitId,
      type: amount < 0 ? 'DEBIT' : 'CREDIT',
      date,
      amount: Math.abs(amount),
      description: memo || name || trnType,
      reference: checkNum || undefined,
    });
  }

  return transactions;
}
