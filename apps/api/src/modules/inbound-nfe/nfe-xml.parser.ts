export interface ParsedNfe {
  chaveNfe: string;        // infNFe.Id attribute stripped of "NFe"
  nfeNumber: string;       // ide.nNF
  series: string;          // ide.serie
  supplierCnpj: string;    // emit.CNPJ
  supplierName: string;    // emit.xNome
  issueDate: string;       // ide.dhEmi or ide.dEmi
  totalValue: number;      // total.ICMSTot.vNF
  items: ParsedNfeItem[];
}

export interface ParsedNfeItem {
  ncm: string;             // prod.NCM
  description: string;     // prod.xProd
  quantity: number;        // prod.qCom
  unitPrice: number;       // prod.vUnCom
  totalPrice: number;      // prod.vProd
  cfop: string;            // prod.CFOP
  ean: string;             // prod.cEAN (may be 'SEM GTIN')
}

export function parseNfeXml(xml: string): ParsedNfe {
  // Extract using regex helpers
  const extract = (tag: string): string => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`));
    return m ? m[1].trim() : '';
  };

  // Extract chaveNfe from Id attribute: Id="NFe12345..."
  const idMatch = xml.match(/Id="NFe(\d{44})"/);
  const chaveNfe = idMatch ? idMatch[1] : extract('chNFe');

  // Extract items: each <det nItem="N"> block
  const items: ParsedNfeItem[] = [];
  const detBlocks = xml.match(/<det\s[^>]*>[\s\S]*?<\/det>/g) ?? [];
  for (const det of detBlocks) {
    const extractDet = (tag: string): string => {
      const m = det.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`));
      return m ? m[1].trim() : '';
    };
    items.push({
      ncm: extractDet('NCM'),
      description: extractDet('xProd'),
      quantity: parseFloat(extractDet('qCom') || '0'),
      unitPrice: parseFloat(extractDet('vUnCom') || '0'),
      totalPrice: parseFloat(extractDet('vProd') || '0'),
      cfop: extractDet('CFOP'),
      ean: extractDet('cEAN'),
    });
  }

  return {
    chaveNfe,
    nfeNumber: extract('nNF'),
    series: extract('serie'),
    supplierCnpj: extract('CNPJ'),
    supplierName: extract('xNome'),
    issueDate: extract('dhEmi') || extract('dEmi'),
    totalValue: parseFloat(extract('vNF') || '0'),
    items,
  };
}
