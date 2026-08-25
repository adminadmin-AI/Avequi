import { XmlParseError, child, children, decodeEntities, findFirst, parseXml, path, text } from './xml-tree';

describe('xml-tree — parser mínimo sem dependência', () => {
  it('monta árvore com atributos, texto, namespaces e auto-fechamento', () => {
    const root = parseXml(
      `<?xml version="1.0" encoding="UTF-8"?>
       <!-- comentário -->
       <a:nfeProc versao="4.00" xmlns:a="http://x"><NFe><infNFe Id='NFe1' versao="4.00"><ide><nNF> 123 </nNF><empty/></ide></infNFe></NFe></a:nfeProc>`,
    );
    expect(root.name).toBe('nfeProc');
    expect(root.attrs.versao).toBe('4.00');
    expect(root.attrs['xmlns:a'] ?? root.attrs.a).toBeDefined();
    const inf = path(root, 'NFe', 'infNFe');
    expect(inf?.attrs.Id).toBe('NFe1');
    expect(text(inf, 'ide', 'nNF')).toBe('123');
    expect(child(path(root, 'NFe', 'infNFe', 'ide'), 'empty')?.children).toEqual([]);
    expect(text(inf, 'ide', 'empty')).toBeNull();
  });

  it('decodifica entidades no texto e em atributos; lê CDATA', () => {
    const root = parseXml(`<r t="a &amp; b"><x>1 &lt; 2 &#38; &#x41;</x><c><![CDATA[<raw>&amp;]]></c></r>`);
    expect(root.attrs.t).toBe('a & b');
    expect(text(root, 'x')).toBe('1 < 2 & A');
    expect(text(root, 'c')).toBe('<raw>&amp;');
    expect(decodeEntities('&unknown;')).toBe('&unknown;');
    expect(decodeEntities('&#x110000;')).toBe('&#x110000;'); // fora da faixa Unicode: literal, sem RangeError
    expect(decodeEntities('&#169;')).toBe('©');
  });

  it('atributos com aspas simples, ">" dentro de valor e sem espaço entre atributos', () => {
    const root = parseXml(`<r a='x>y' b="1"c='2'><v>1 > 0</v></r>`);
    expect(root.attrs).toEqual({ a: 'x>y', b: '1', c: '2' });
    expect(text(root, 'v')).toBe('1 > 0');
  });

  it('elementos opcionais ausentes e ordem diferente não quebram a leitura', () => {
    const root = parseXml(`<det><imposto><PIS><PISNT><CST>07</CST></PISNT></PIS><ICMS><ICMS00><CST>00</CST></ICMS00></ICMS></imposto><prod><xProd>P</xProd></prod></det>`);
    expect(text(root, 'prod', 'xProd')).toBe('P');
    expect(text(root, 'prod', 'NCM')).toBeNull();
    expect(text(root, 'imposto', 'ICMS', 'ICMS00', 'CST')).toBe('00');
    expect(text(root, 'imposto', 'IPI', 'IPITrib', 'CST')).toBeNull();
  });

  it('não confunde tags homônimas em grupos diferentes', () => {
    const root = parseXml(`<n><emit><CNPJ>111</CNPJ></emit><dest><CNPJ>222</CNPJ></dest><transporta><CNPJ>333</CNPJ></transporta></n>`);
    expect(text(root, 'emit', 'CNPJ')).toBe('111');
    expect(text(root, 'dest', 'CNPJ')).toBe('222');
    expect(children(root, 'emit')).toHaveLength(1);
    expect(findFirst(root, 'CNPJ')?.text).toBe('111');
  });

  it('rejeita XML truncado ou mal aninhado (nunca "meio lido")', () => {
    expect(() => parseXml('<a><b>1</a>')).toThrow(XmlParseError);
    expect(() => parseXml('<a><b>1</b>')).toThrow(XmlParseError);
    expect(() => parseXml('<a x=1></a>')).toThrow(XmlParseError);
    expect(() => parseXml('<a></a><b></b>')).toThrow(/exatamente 1 raiz/);
  });

  it('ignora BOM, prólogo e DOCTYPE', () => {
    const root = parseXml('﻿<?xml version="1.0"?><!DOCTYPE r><r><v>ok</v></r>');
    expect(text(root, 'v')).toBe('ok');
  });
});
