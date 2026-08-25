import {
  CROSS_TENANT_REUSABLE_FIELDS,
  TENANT_SPECIFIC_FIELDS,
  assessConflicts,
  buildSupplierDraft,
  decideCreation,
  parseEmit,
  taxRegimeFromCrt,
} from './supplier-import.rules';

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
  it('IE que mudou só no passado distante usa a mais recente com nota', () => {
    const c = assessConflicts(emit.cnpj, {
      emitsNewestFirst: [emit, emit, { ...emit, ie: 'IE-ANTIGA' }],
      distinctIssuerNames: [],
    });
    expect(c.review).toBe(false);
    expect(c.notes.join(' ')).toContain('IE mudou');
  });
});
