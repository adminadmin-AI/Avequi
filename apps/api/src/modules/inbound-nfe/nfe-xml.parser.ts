export interface ParsedNfe {
  chaveNfe: string;        // infNFe.Id attribute stripped of "NFe"
  nfeNumber: string;       // ide.nNF
  series: string;          // ide.serie
  supplierCnpj: string;    // emit.CNPJ
  supplierName: string;    // emit.xNome
  issueDate: string;       // ide.dhEmi or ide.dEmi
  totalValue: number;      // total.ICMSTot.vNF
  items: ParsedNfeItem[];
  emitter: ParsedNfeEmitter; // bloco <emit> completo — enriquece o cadastro do fornecedor (#478)
}

/** Dados fiscais do emitente (bloco <emit>) — fonte p/ completar o Supplier (#478) */
export interface ParsedNfeEmitter {
  razaoSocial: string;     // emit.xNome
  fantasia: string;        // emit.xFant
  ie: string;              // emit.IE
  crt: string;             // emit.CRT (1=Simples, 3=Regime Normal)
  address: string;         // enderEmit.xLgr
  number: string;          // enderEmit.nro
  complement: string;      // enderEmit.xCpl
  neighborhood: string;    // enderEmit.xBairro
  city: string;            // enderEmit.xMun
  state: string;           // enderEmit.UF
  zipCode: string;         // enderEmit.CEP
  ibgeCode: string;        // enderEmit.cMun
  phone: string;           // enderEmit.fone
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

  // Bloco <emit> isolado — os mesmos tags (xNome, CEP...) também existem em <dest> (#478)
  const emitBlock = xml.match(/<emit>[\s\S]*?<\/emit>/)?.[0] ?? '';
  const extractEmit = (tag: string): string => {
    const m = emitBlock.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`));
    return m ? m[1].trim() : '';
  };

  return {
    chaveNfe,
    nfeNumber: extract('nNF'),
    series: extract('serie'),
    supplierCnpj: extract('CNPJ'),
    supplierName: extract('xNome'),
    issueDate: extract('dhEmi') || extract('dEmi'),
    totalValue: parseFloat(extract('vNF') || '0'),
    items,
    emitter: {
      razaoSocial: extractEmit('xNome'),
      fantasia: extractEmit('xFant'),
      ie: extractEmit('IE'),
      crt: extractEmit('CRT'),
      address: extractEmit('xLgr'),
      number: extractEmit('nro'),
      complement: extractEmit('xCpl'),
      neighborhood: extractEmit('xBairro'),
      city: extractEmit('xMun'),
      state: extractEmit('UF'),
      zipCode: extractEmit('CEP'),
      ibgeCode: extractEmit('cMun'),
      phone: extractEmit('fone'),
    },
  };
}
