import { NfeXmlError, parseNfeDocument, TP_EVENTO } from './nfe-proc.parser';
import { CHAVE, CNPJ_DEST, CNPJ_EMIT, eventoXml, nfeXml } from './nfe-fixtures';

describe('nfe-proc.parser — nfeProc 4.00', () => {
  const doc = parseNfeDocument(nfeXml());
  const nfe = doc.kind === 'NFE' ? doc : (fail('esperava NFE') as never);

  it('lê cabeçalho, partes e protocolo sem confundir grupos homônimos', () => {
    expect(nfe.chave).toBe(CHAVE);
    expect(nfe.mod).toBe('55');
    expect(nfe.serie).toBe(1);
    expect(nfe.nNF).toBe(12345);
    expect(nfe.dhEmi).toBe('2026-06-15T09:59:00-03:00');
    expect(nfe.tpNF).toBe(1);
    expect(nfe.natOp).toBe('VENDA DE MERCADORIA');
    expect(nfe.emit.cnpj).toBe(CNPJ_EMIT);
    expect(nfe.emit.xNome).toBe('FORNECEDOR FICTICIO LTDA');
    expect(nfe.emit.uf).toBe('PR');
    expect(nfe.dest.cnpj).toBe(CNPJ_DEST); // e não o CNPJ da <transporta>
    expect(nfe.prot?.nProt).toBe('141260000000001');
    expect(nfe.prot?.dhRecbto).toBe('2026-06-15T10:00:05-03:00');
    expect(nfe.prot?.cStat).toBe('100');
    expect(nfe.chaveConsistente).toBe(true);
    expect(nfe.infCpl).toBe('PEDIDO 77 & 78 => ENTREGA');
  });

  it('totais como string decimal (sem float)', () => {
    expect(nfe.totals.vNF).toBe('5318.08');
    expect(nfe.totals.vProd).toBe('5065.55');
    expect(nfe.totals.vICMSUFDest).toBe('353.54');
    expect(nfe.totals.vFCPUFDest).toBe('101.01');
  });

  it('itens: campos canônicos + impostos estruturados por grupo', () => {
    expect(nfe.items).toHaveLength(2);
    const [i1, i2] = nfe.items;
    expect(i1.nItem).toBe(1);
    expect(i1.cProd).toBe('8429');
    expect(i1.xProd).toBe('CHAPA DE ACO 2 MM');
    expect(i1.ncm).toBe('73089010');
    expect(i1.cest).toBe('0104900');
    expect(i1.cfop).toBe('6101');
    expect(i1.uCom).toBe('KG');
    expect(i1.qCom).toBe('1217.0000');
    expect(i1.vUnCom).toBe('4.1500000000');
    expect(i1.vProd).toBe('5050.55');
    expect(i1.icms).toEqual({ grupo: 'ICMS00', orig: '0', cst: '00', csosn: null, modBC: '3', vBC: '5050.55', pICMS: '12.0000', vICMS: '606.07' });
    expect(i1.ipi).toEqual({ grupo: 'IPITrib', cst: '50', vBC: '5050.55', aliquota: '5.00', valor: '252.53' });
    expect(i1.pis).toEqual({ grupo: 'PISAliq', cst: '01', vBC: '4444.48', aliquota: '0.6500', valor: '28.89' });
    expect(i1.cofins?.valor).toBe('133.33');
    expect(i1.difal).toEqual({ vBCUFDest: '5050.55', pFCPUFDest: '2.00', pICMSUFDest: '19.00', pICMSInter: '12.00', vFCPUFDest: '101.01', vICMSUFDest: '353.54' });
    expect(i1.ibsCbs).toBeNull();

    // Simples Nacional: CSOSN em vez de CST; IPI/PIS/COFINS não tributados só com CST
    expect(i2.icms).toEqual({ grupo: 'ICMSSN102', orig: '2', cst: null, csosn: '102', modBC: null, vBC: null, pICMS: null, vICMS: null });
    expect(i2.ipi).toEqual({ grupo: 'IPINT', cst: '53', vBC: null, aliquota: null, valor: null });
    expect(i2.pis?.cst).toBe('07');
    expect(i2.cofins?.grupo).toBe('COFINSNT');
    expect(i2.difal).toBeNull();
    expect(i2.cest).toBeNull();
  });

  it('lê grupo IBS/CBS (NT 2025.002) quando presente', () => {
    const items = `<det nItem="1"><prod><cProd>X</cProd><xProd>P</xProd><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod>
      <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS>
      <IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>10.00</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>0.01</vIBSUF></gIBSUF>
      <gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><gCBS><pCBS>0.9000</pCBS><vCBS>0.09</vCBS></gCBS></gIBSCBS></IBSCBS></imposto></det>`;
    const d = parseNfeDocument(nfeXml({ items }));
    expect(d.kind).toBe('NFE');
    if (d.kind !== 'NFE') return;
    expect(d.items[0].ibsCbs).toEqual({ cst: '000', cClassTrib: '000001', vBC: '10.00', pIBSUF: '0.1000', vIBSUF: '0.01', pIBSMun: '0.0000', vIBSMun: '0.00', pCBS: '0.9000', vCBS: '0.09' });
  });

  it('XML de <NFe> sem <protNFe> tem prot=null (não autorizada)', () => {
    const d = parseNfeDocument(nfeXml({ withProt: false }));
    expect(d.kind === 'NFE' && d.prot).toBeNull();
  });

  it('chave inconsistente entre Id e protNFe é detectada', () => {
    const d = parseNfeDocument(nfeXml({ chNFeProt: '41260611111111000191550010000123451000099999' }));
    expect(d.kind === 'NFE' && d.chaveConsistente).toBe(false);
  });

  it('rejeita estrutura inválida (Id, itens obrigatórios) — nunca nota parcial', () => {
    expect(() => parseNfeDocument(nfeXml().replace(`Id="NFe${CHAVE}"`, 'Id="NFe123"'))).toThrow(NfeXmlError);
    expect(() => parseNfeDocument(nfeXml({ items: '' }))).toThrow(/sem <det>/);
    expect(() => parseNfeDocument(nfeXml({ items: '<det nItem="1"><prod><xProd>P</xProd></prod></det>' }))).toThrow(/obrigatórios/);
    expect(() => parseNfeDocument(nfeXml({ items: '<det><prod><xProd>P</xProd><qCom>1</qCom><vUnCom>1</vUnCom><vProd>1</vProd></prod></det>' }))).toThrow(/nItem/);
  });
});

describe('nfe-proc.parser — eventos (procEventoNFe)', () => {
  it('cancelamento registrado (135) com justificativa e retEvento', () => {
    const d = parseNfeDocument(eventoXml({ tpEvento: TP_EVENTO.CANCELAMENTO }));
    expect(d.kind).toBe('EVENTO');
    if (d.kind !== 'EVENTO') return;
    expect(d.chNFe).toBe(CHAVE);
    expect(d.tpEvento).toBe('110111');
    expect(d.nSeqEvento).toBe(1);
    expect(d.dhEvento).toBe('2026-06-16T07:59:00-03:00');
    expect(d.xJust).toBe('ERRO DE DIGITACAO NO PEDIDO');
    expect(d.ret).toEqual({ cStat: '135', nProt: '141260000000002', dhRegEvento: '2026-06-16T08:00:00-03:00' });
  });

  it('carta de correção traz xCorrecao; evento sem retEvento tem ret=null', () => {
    const cce = parseNfeDocument(eventoXml({ tpEvento: TP_EVENTO.CARTA_CORRECAO, withRet: false }));
    expect(cce.kind === 'EVENTO' && cce.xCorrecao).toBe('FRETE POR CONTA DO DESTINATARIO');
    expect(cce.kind === 'EVENTO' && cce.ret).toBeNull();
  });

  it('raiz desconhecida vira UNKNOWN (não lança)', () => {
    expect(parseNfeDocument('<cteProc><CTe/></cteProc>')).toEqual({ kind: 'UNKNOWN', rootName: 'cteProc' });
  });
});
