/**
 * Fixtures SINTÉTICAS de NF-e 4.00 / eventos para testes (dados fictícios;
 * CNPJs inventados e sem dígito verificador válido de propósito).
 */

export const CNPJ_EMIT = '11111111000191';
export const CNPJ_DEST = '22222222000172';
export const CHAVE = '41260611111111000191550010000123451000012345';

export interface FixtureOptions {
  chave?: string;
  emitCnpj?: string;
  destCnpj?: string;
  nNF?: string;
  serie?: string;
  mod?: string;
  tpAmb?: string;
  cStat?: string;
  withProt?: boolean;
  chNFeProt?: string;
  vNF?: string;
  items?: string; // bloco <det> completo (override)
  finNFe?: string;
  dhEmi?: string;
  encodingDecl?: string;
}

export const ITEM_ICMS00 = `
  <det nItem="1">
    <prod><cProd>8429</cProd><cEAN>SEM GTIN</cEAN><xProd>CHAPA DE ACO 2 MM</xProd><NCM>73089010</NCM><CEST>0104900</CEST><CFOP>6101</CFOP>
      <uCom>KG</uCom><qCom>1217.0000</qCom><vUnCom>4.1500000000</vUnCom><vProd>5050.55</vProd></prod>
    <imposto>
      <ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>5050.55</vBC><pICMS>12.0000</pICMS><vICMS>606.07</vICMS></ICMS00></ICMS>
      <IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>5050.55</vBC><pIPI>5.00</pIPI><vIPI>252.53</vIPI></IPITrib></IPI>
      <PIS><PISAliq><CST>01</CST><vBC>4444.48</vBC><pPIS>0.6500</pPIS><vPIS>28.89</vPIS></PISAliq></PIS>
      <COFINS><COFINSAliq><CST>01</CST><vBC>4444.48</vBC><pCOFINS>3.0000</pCOFINS><vCOFINS>133.33</vCOFINS></COFINSAliq></COFINS>
      <ICMSUFDest><vBCUFDest>5050.55</vBCUFDest><pFCPUFDest>2.00</pFCPUFDest><pICMSUFDest>19.00</pICMSUFDest><pICMSInter>12.00</pICMSInter><vFCPUFDest>101.01</vFCPUFDest><vICMSUFDest>353.54</vICMSUFDest></ICMSUFDest>
    </imposto>
  </det>
  <det nItem="2">
    <prod><cProd>A-77</cProd><xProd>PARAFUSO M8</xProd><NCM>73181500</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>1.5000</vUnCom><vProd>15.00</vProd></prod>
    <imposto>
      <ICMS><ICMSSN102><orig>2</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>
      <IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI>
      <PIS><PISNT><CST>07</CST></PISNT></PIS>
      <COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>
    </imposto>
  </det>`;

export function nfeXml(o: FixtureOptions = {}): string {
  const chave = o.chave ?? CHAVE;
  const withProt = o.withProt ?? true;
  const prot = withProt
    ? `<protNFe versao="4.00"><infProt Id="ID141260000000001"><tpAmb>${o.tpAmb ?? '1'}</tpAmb><verAplic>PR-v4</verAplic><chNFe>${o.chNFeProt ?? chave}</chNFe>
         <dhRecbto>2026-06-15T10:00:05-03:00</dhRecbto><nProt>141260000000001</nProt><digVal>x</digVal><cStat>${o.cStat ?? '100'}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`
    : '';
  const decl = o.encodingDecl ?? 'UTF-8';
  return `<?xml version="1.0" encoding="${decl}"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe versao="4.00" Id="NFe${chave}">
      <ide><cUF>41</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>${o.mod ?? '55'}</mod><serie>${o.serie ?? '1'}</serie><nNF>${o.nNF ?? '12345'}</nNF>
        <dhEmi>${o.dhEmi ?? '2026-06-15T09:59:00-03:00'}</dhEmi><tpNF>1</tpNF><tpAmb>${o.tpAmb ?? '1'}</tpAmb><finNFe>${o.finNFe ?? '1'}</finNFe></ide>
      <emit><CNPJ>${o.emitCnpj ?? CNPJ_EMIT}</CNPJ><xNome>FORNECEDOR FICTICIO LTDA</xNome><xFant>FICTICIO</xFant>
        <enderEmit><xLgr>RUA A</xLgr><nro>1</nro><xMun>CURITIBA</xMun><UF>PR</UF><CEP>80000000</CEP></enderEmit><IE>123</IE><CRT>3</CRT></emit>
      <dest><CNPJ>${o.destCnpj ?? CNPJ_DEST}</CNPJ><xNome>EMPRESA DO ERP</xNome><enderDest><xMun>SJP</xMun><UF>PR</UF></enderDest><IE>456</IE></dest>
      ${o.items ?? ITEM_ICMS00}
      <total><ICMSTot><vBC>5050.55</vBC><vICMS>606.07</vICMS><vProd>5065.55</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc>
        <vIPI>252.53</vIPI><vPIS>28.89</vPIS><vCOFINS>133.33</vCOFINS><vOutro>0.00</vOutro><vNF>${o.vNF ?? '5318.08'}</vNF><vICMSUFDest>353.54</vICMSUFDest><vFCPUFDest>101.01</vFCPUFDest></ICMSTot></total>
      <transp><modFrete>1</modFrete><transporta><CNPJ>99999999000199</CNPJ><xNome>TRANSPORTADORA</xNome></transporta></transp>
      <infAdic><infCpl>PEDIDO 77 &amp; 78 =&gt; ENTREGA</infCpl></infAdic>
    </infNFe>
    <Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><Reference URI="#NFe${chave}"/></SignedInfo><SignatureValue>abc</SignatureValue></Signature>
  </NFe>
  ${prot}
</nfeProc>`;
}

export function eventoXml(o: { chave?: string; tpEvento: string; cStat?: string; nSeq?: number; xJust?: string; xCorrecao?: string; withRet?: boolean; dhEvento?: string }): string {
  const chave = o.chave ?? CHAVE;
  const det =
    o.tpEvento === '110111'
      ? `<descEvento>Cancelamento</descEvento><nProt>141260000000001</nProt><xJust>${o.xJust ?? 'ERRO DE DIGITACAO NO PEDIDO'}</xJust>`
      : o.tpEvento === '110110'
        ? `<descEvento>Carta de Correcao</descEvento><xCorrecao>${o.xCorrecao ?? 'FRETE POR CONTA DO DESTINATARIO'}</xCorrecao>`
        : `<descEvento>Ciencia da Operacao</descEvento>`;
  const ret =
    (o.withRet ?? true)
      ? `<retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><cOrgao>41</cOrgao><cStat>${o.cStat ?? '135'}</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo>
           <chNFe>${chave}</chNFe><tpEvento>${o.tpEvento}</tpEvento><nSeqEvento>${o.nSeq ?? 1}</nSeqEvento><dhRegEvento>2026-06-16T08:00:00-03:00</dhRegEvento><nProt>141260000000002</nProt></infEvento></retEvento>`
      : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <evento versao="1.00"><infEvento Id="ID${o.tpEvento}${chave}0${o.nSeq ?? 1}"><cOrgao>41</cOrgao><tpAmb>1</tpAmb><CNPJ>${CNPJ_EMIT}</CNPJ><chNFe>${chave}</chNFe>
    <dhEvento>${o.dhEvento ?? '2026-06-16T07:59:00-03:00'}</dhEvento><tpEvento>${o.tpEvento}</tpEvento><nSeqEvento>${o.nSeq ?? 1}</nSeqEvento><verEvento>1.00</verEvento>
    <detEvento versao="1.00">${det}</detEvento></infEvento></evento>
  ${ret}
</procEventoNFe>`;
}
