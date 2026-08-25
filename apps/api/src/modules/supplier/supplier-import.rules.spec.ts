import {
  CROSS_TENANT_REUSABLE_FIELDS,
  TENANT_SPECIFIC_FIELDS,
  assessConflicts,
  buildSupplierDraft,
  decideCreation,
  mergeEmitsNewestFirst,
  orderEvidenceNewestFirst,
  pairKey,
  parseEmit,
  taxRegimeFromCrt,
} from './supplier-import.rules';
import { sameIdSet } from '../../fiscal/rehydration/rehydration-core';

const XML = `
<nfeProc><NFe><infNFe Id="NFe412608062088990001605500..."><emit>
  <CNPJ>06.889.977/0001-98</CNPJ>
  <xNome>RODA BRASIL PNEUS LTDA</xNome>
  <xFant>RODA BRASIL</xFant>
  <IE>9057000000</IE><CRT>3</CRT>
  <enderEmit>
    <xLgr>AV INDUSTRIAL</xLgr><nro>1000</nro><xBairro>PARQUE</xBairro>
    <cMun>4113700</cMun><xMun>LONDRINA</xMun><UF>PR</UF><CEP>86000-000</CEP>
    <fone>4333330000</fone>
  </enderEmit>
</emit></infNFe></NFe></nfeProc>`;

const emit = parseEmit(XML)!;

describe('parse do emitente no XML da NF-e (enriquecimento fiscal)', () => {
  it('extrai razão, fantasia, IE, CRT, endereço, município/UF/CEP/IBGE e fone', () => {
    expect(emit.cnpj).toBe('06889977000198');
    expect(emit.xNome).toBe('RODA BRASIL PNEUS LTDA');
    expect(emit.xFant).toBe('RODA BRASIL');
    expect(emit.ie).toBe('9057000000');
    expect(emit.address).toBe('AV INDUSTRIAL');
    expect(emit.city).toBe('LONDRINA');
    expect(emit.state).toBe('PR');
    expect(emit.zipCode).toBe('86000000');
    expect(emit.ibgeCode).toBe('4113700');
    expect(emit.phone).toBe('4333330000');
  });
  it('decodifica entidades XML do <emit> uma única vez (mesma função do parser canônico)', () => {
    const xml = `<nfeProc><NFe><infNFe><emit><CNPJ>61909155000130</CNPJ>
      <xNome>B &amp; M COMERCIO DE MADEIRAS</xNome><xFant>VERDE &amp; NOBRE &lt;SUL&gt;</xFant>
      <enderEmit><xLgr>R. S&#227;o Jo&#xE3;o &quot;A&quot;</xLgr><xBairro>D&apos;OESTE</xBairro><xMun>Rio Branco</xMun><UF>AC</UF></enderEmit>
      <IE>0110399200170</IE></emit></infNFe></NFe></nfeProc>`;
    const e = parseEmit(xml)!;
    expect(e.xNome).toBe('B & M COMERCIO DE MADEIRAS'); // &amp;
    expect(e.xFant).toBe('VERDE & NOBRE <SUL>'); // &lt; &gt;
    expect(e.address).toBe('R. São João "A"'); // numéricas decimal e hex + &quot;
    expect(e.neighborhood).toBe("D'OESTE"); // &apos;
    // o valor decodificado chega intacto ao cadastro (razão E exibição)
    const draft = buildSupplierDraft({ companyId: 'co-gdr', issuerCnpj: '61909155000130', issuerName: 'B & M COMERCIO DE MADEIRAS', latestEmit: e, crossTenant: null, omieFantasia: null });
    expect(draft.razaoSocial).toBe('B & M COMERCIO DE MADEIRAS');
    expect(draft.name).toBe('VERDE & NOBRE <SUL>');
  });
  it('não decodifica duas vezes: "&amp;amp;" vira "&amp;" literal, não "&"', () => {
    const e = parseEmit(`<emit><CNPJ>61909155000130</CNPJ><xNome>A &amp;amp; B</xNome></emit>`)!;
    expect(e.xNome).toBe('A &amp; B');
  });
  it('sem entidade nada muda (comportamento normal preservado)', () => {
    expect(emit.xNome).toBe('RODA BRASIL PNEUS LTDA');
    expect(parseEmit(`<emit><CNPJ>61909155000130</CNPJ><xNome>ACOS MOURA PRODUTOS SIDERURGICOS LTDA</xNome></emit>`)!.xNome).toBe('ACOS MOURA PRODUTOS SIDERURGICOS LTDA');
  });
  it('sem XML ou sem <emit> → null (não bloqueia criação)', () => {
    expect(parseEmit(null)).toBeNull();
    expect(parseEmit('<xml>vazio</xml>')).toBeNull();
  });
  it('CRT 1/2 → Simples; CRT 3 é ambíguo (presumido OU real) → não inferir', () => {
    expect(taxRegimeFromCrt('1')).toBe('SIMPLES_NACIONAL');
    expect(taxRegimeFromCrt('2')).toBe('SIMPLES_NACIONAL');
    expect(taxRegimeFromCrt('3')).toBeNull();
    expect(taxRegimeFromCrt(null)).toBeNull();
  });
});

describe('montagem do cadastro — precedência POR CAMPO', () => {
  const base = {
    companyId: 'co-crd',
    issuerCnpj: '06889977000198',
    issuerName: 'RODA BRASIL PNEUS LTDA (NF)',
    latestEmit: emit,
    crossTenant: null,
    omieFantasia: null,
  };
  it('novo Supplier nasce no tenant correto com dados fiscais do XML', () => {
    const d = buildSupplierDraft(base);
    expect(d.companyId).toBe('co-crd');
    expect(d.cnpj).toBe('06889977000198');
    expect(d.razaoSocial).toBe('RODA BRASIL PNEUS LTDA'); // XML vence issuerName
    expect(d.name).toBe('RODA BRASIL'); // xFant vence razão social
    expect(d.ie).toBe('9057000000');
    expect(d.city).toBe('LONDRINA');
  });
  it('Omie fantasia vence xFant no campo de exibição — e só nele', () => {
    const d = buildSupplierDraft({ ...base, omieFantasia: 'RODA BRASIL PNEUS' });
    expect(d.name).toBe('RODA BRASIL PNEUS');
    expect(d.razaoSocial).toBe('RODA BRASIL PNEUS LTDA'); // Omie não sobrepõe fiscal
  });
  it('ausência de Omie não bloqueia criação (fallback razão social)', () => {
    const d = buildSupplierDraft({ ...base, latestEmit: { ...emit, xFant: null }, omieFantasia: null });
    expect(d.name).toBe('RODA BRASIL PNEUS LTDA');
  });
  it('sem XML: cria com issuerName do FiscalDocument (autoridade do ERP)', () => {
    const d = buildSupplierDraft({ ...base, latestEmit: null });
    expect(d.razaoSocial).toBe('RODA BRASIL PNEUS LTDA (NF)');
    expect(d.ie).toBeNull();
  });
  it('homônimo de OUTRO tenant só preenche LACUNA de campos classe A', () => {
    const ct = { razaoSocial: 'RODA BRASIL GDR', ie: 'IE-GDR', city: 'CIDADE-GDR' } as any;
    // com XML: XML vence o cross-tenant em todos os campos
    expect(buildSupplierDraft({ ...base, crossTenant: ct }).ie).toBe('9057000000');
    // sem XML: cross-tenant preenche a lacuna
    const semXml = buildSupplierDraft({ ...base, latestEmit: null, issuerName: null, crossTenant: ct });
    expect(semXml.razaoSocial).toBe('RODA BRASIL GDR');
    expect(semXml.ie).toBe('IE-GDR');
  });
  it('NENHUM campo tenant-específico é clonado de outro Supplier (classe B fora do draft)', () => {
    const d = buildSupplierDraft(base) as Record<string, unknown>;
    for (const f of TENANT_SPECIFIC_FIELDS) {
      if (f === 'phone') continue; // phone vem da NF-e (dado fiscal), nunca do outro tenant
      expect(d[f]).toBeUndefined();
    }
    // e a lista de reutilizáveis não contém nenhum campo de relação comercial
    for (const f of ['defaultPaymentTerms', 'bankAccount', 'pixKey', 'email', 'contactName', 'leadTimeDays', 'isActive']) {
      expect((CROSS_TENANT_REUSABLE_FIELDS as readonly string[]).includes(f)).toBe(false);
    }
  });
});

describe('idempotência e dedup por (companyId, cnpj)', () => {
  const noConflict = { review: false, reasons: [], notes: [] };
  it('duplicata no MESMO tenant não é criada (ALREADY_EXISTS)', () => {
    expect(decideCreation(true, noConflict)).toBe('ALREADY_EXISTS');
  });
  it('mesmo CNPJ em DOIS tenants é permitido (outro tenant não conta como match local)', () => {
    // existsInSameTenant=false mesmo com homônimo na GDR → cria na CRD
    expect(decideCreation(false, noConflict)).toBe('CREATE');
  });
  it('reexecução idempotente: segunda rodada devolve ALREADY_EXISTS', () => {
    const primeira = decideCreation(false, noConflict);
    const segunda = decideCreation(true, noConflict);
    expect(primeira).toBe('CREATE');
    expect(segunda).toBe('ALREADY_EXISTS');
  });
});

describe('conflitos de identidade fiscal', () => {
  it('XML com CNPJ interno diferente do issuerCnpj → REVIEW (identidade quebrada)', () => {
    const c = assessConflicts('11111111000111', {
      emitsNewestFirst: [emit],
      distinctIssuerNames: [],
    });
    expect(c.review).toBe(true);
    expect(decideCreation(false, c)).toBe('REVIEW');
  });
  it('IE divergente entre os DOIS XMLs mais recentes → REVIEW', () => {
    const c = assessConflicts(emit.cnpj, {
      emitsNewestFirst: [emit, { ...emit, ie: 'OUTRA-IE' }],
      distinctIssuerNames: [],
    });
    expect(c.review).toBe(true);
  });
  it('mudança histórica de razão social/endereço é nota, não conflito fatal', () => {
    const antigo = { ...emit, xNome: 'RODA BRASIL COMERCIO DE PNEUS LTDA', city: 'CAMBE' };
    const c = assessConflicts(emit.cnpj, {
      emitsNewestFirst: [emit, { ...emit, ie: emit.ie }, antigo],
      distinctIssuerNames: ['RODA BRASIL PNEUS LTDA', 'RODA BRASIL COMERCIO DE PNEUS LTDA'],
    });
    expect(c.review).toBe(false);
    expect(c.notes.length).toBeGreaterThan(0);
  });
  it('inconsistência material não explicável → REVIEW, nunca cadastro inventado', () => {
    const c = assessConflicts(emit.cnpj, {
      emitsNewestFirst: [emit, { ...emit, ie: 'IE-CONFLITANTE' }],
      distinctIssuerNames: [],
    });
    expect(decideCreation(false, c)).toBe('REVIEW');
  });
  it('IE que mudou só no passado distante usa a mais recente com nota', () => {
    const c = assessConflicts(emit.cnpj, {
      emitsNewestFirst: [emit, emit, { ...emit, ie: 'IE-ANTIGA' }],
      distinctIssuerNames: [],
    });
    expect(c.review).toBe(false);
    expect(c.notes.join(' ')).toContain('IE mudou');
  });
});

describe('gate nominal dry-run ⇄ commit (mesmo princípio do reidratador)', () => {
  const A = [pairKey('co-crd', '06889977000198'), pairKey('co-gdr', '06889977000198'), pairKey('co-crd', '09398976000139')].sort();
  it('dry-run com conjunto A → commit recomputa A → permitido', () => {
    expect(sameIdSet(A, [...A].reverse())).toBe(true);
  });
  it('candidato NOVO entre dry-run e commit → abort', () => {
    expect(sameIdSet(A, [...A, pairKey('co-crd', '11111111000111')])).toBe(false);
  });
  it('candidato REMOVIDO (ex.: Supplier criado no meio-tempo) → abort', () => {
    expect(sameIdSet(A, A.slice(1))).toBe(false);
  });
  it('mudança de tenant na identidade → abort', () => {
    const trocado = [...A.slice(1), pairKey('co-gdr', '09398976000139')];
    expect(sameIdSet(A, trocado)).toBe(false);
  });
  it('mesma quantidade mas pares diferentes → abort', () => {
    const outros = [...A.slice(1), pairKey('co-crd', '22222222000122')];
    expect(outros.length).toBe(A.length);
    expect(sameIdSet(A, outros)).toBe(false);
  });
  it('pairKey normaliza CNPJ (máscara não cria identidade nova)', () => {
    expect(pairKey('co-crd', '06.889.977/0001-98')).toBe(pairKey('co-crd', '06889977000198'));
  });
});

describe('determinismo temporal das evidências fiscais', () => {
  const antigo = { ...emit, xNome: 'RODA BRASIL COMERCIO DE PNEUS LTDA', city: 'CAMBE', zipCode: '86181000' };
  const novo = { ...emit }; // LONDRINA, razão atual
  const dNovo = { emit: novo, issueDate: '2026-06-01T10:00:00-03:00', docId: 'doc-b' };
  const dAntigo = { emit: antigo, issueDate: '2024-01-01T10:00:00-03:00', docId: 'doc-a' };

  it('mudança histórica legítima de endereço → escolhe deterministicamente o registro fiscal mais recente', () => {
    const merged = mergeEmitsNewestFirst(orderEvidenceNewestFirst([dAntigo, dNovo]))!;
    expect(merged.city).toBe('LONDRINA');
    expect(merged.xNome).toBe('RODA BRASIL PNEUS LTDA');
  });
  it('XMLs fornecidos em ordem diferente → resultado cadastral idêntico', () => {
    const a = mergeEmitsNewestFirst(orderEvidenceNewestFirst([dAntigo, dNovo]));
    const b = mergeEmitsNewestFirst(orderEvidenceNewestFirst([dNovo, dAntigo]));
    expect(a).toEqual(b);
  });
  it('dado antigo nunca sobrescreve dado recente; campo AUSENTE no novo cai para o antigo', () => {
    const novoSemCep = { ...novo, zipCode: null };
    const merged = mergeEmitsNewestFirst(
      orderEvidenceNewestFirst([{ emit: novoSemCep, issueDate: dNovo.issueDate, docId: 'doc-b' }, dAntigo]),
    )!;
    expect(merged.city).toBe('LONDRINA'); // recente vence
    expect(merged.zipCode).toBe('86181000'); // lacuna preenchida pelo antigo
  });
  it('empate de issueDate desempata por docId de forma estável', () => {
    const t = '2026-06-01T10:00:00-03:00';
    const x = orderEvidenceNewestFirst([
      { emit: antigo, issueDate: t, docId: 'doc-z' },
      { emit: novo, issueDate: t, docId: 'doc-a' },
    ]);
    expect(x[0]).toEqual(novo); // doc-a vem primeiro
  });
  it('evidência sem data vai para o fim (nunca define o cadastro atual sozinha)', () => {
    const x = orderEvidenceNewestFirst([
      { emit: antigo, issueDate: null, docId: 'doc-a' },
      { emit: novo, issueDate: '2026-06-01T10:00:00-03:00', docId: 'doc-b' },
    ]);
    expect(x[0]).toEqual(novo);
  });
});
