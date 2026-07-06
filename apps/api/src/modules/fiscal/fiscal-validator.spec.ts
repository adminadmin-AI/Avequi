import { formatValidationIssues, validateNfePayload } from './fiscal-validator';

/** Payload mínimo válido — espelho do que buildNFePayload produz */
const validPayload = (overrides: Record<string, any> = {}, item: Record<string, any> = {}) => ({
  data_emissao: '2026-07-06T15:30:00-03:00',
  cnpj_emitente: '46247069000115',
  cpf_destinatario: '04252011043',
  indicador_inscricao_estadual_destinatario: '9',
  consumidor_final: '1',
  modalidade_frete: '9',
  items: [
    {
      numero_item: 1,
      codigo_ncm: '87163900',
      cfop: '5101',
      ibs_cbs_situacao_tributaria: '000',
      ...item,
    },
  ],
  ...overrides,
});

describe('validateNfePayload (#499)', () => {
  it('payload válido não gera issues', () => {
    expect(validateNfePayload(validPayload())).toEqual([]);
  });

  it('data_emissao em UTC (Z) → rej. 577 (nota pula de dia após 21h)', () => {
    const issues = validateNfePayload(validPayload({ data_emissao: '2026-07-06T23:30:00Z' }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '577', field: 'data_emissao' })]);
  });

  it('data_emissao ausente → rej. 509', () => {
    const issues = validateNfePayload(validPayload({ data_emissao: undefined }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '509' })]);
  });

  it('CNPJ do emitente com dígito errado → rej. 207', () => {
    const issues = validateNfePayload(validPayload({ cnpj_emitente: '46247069000199' }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '207', field: 'cnpj_emitente' })]);
  });

  it('CPF do destinatário inválido → rej. 209', () => {
    const issues = validateNfePayload(validPayload({ cpf_destinatario: '12345678900' }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '209', field: 'cpf_destinatario' })]);
  });

  it('IE "ISENTO" literal → rej. 728 (deve omitir IE e usar indicador 2)', () => {
    const issues = validateNfePayload(
      validPayload({ inscricao_estadual_destinatario: 'ISENTO', indicador_inscricao_estadual_destinatario: '2' }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: '728' })]);
  });

  it('contribuinte (indIEDest=1) sem IE → rej. 234', () => {
    const issues = validateNfePayload(
      validPayload({ indicador_inscricao_estadual_destinatario: '1' }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: '234' })]);
  });

  it('devolução (finalidade 4) sem pagamento 90/valor 0 → rej. 871', () => {
    const issues = validateNfePayload(
      validPayload({
        finalidade_emissao: '4',
        formas_pagamento: [{ forma_pagamento: '17', valor_pagamento: 100 }],
      }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: '871' })]);
  });

  it('devolução com pagamento 90/valor 0 passa', () => {
    const issues = validateNfePayload(
      validPayload({
        finalidade_emissao: '4',
        formas_pagamento: [{ forma_pagamento: '90', valor_pagamento: 0 }],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('valor_frete no cabeçalho → rej. 535 (vFrete é rateado por item)', () => {
    const issues = validateNfePayload(validPayload({ valor_frete: 350 }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '535' })]);
  });

  it('NCM placeholder 00000000 → orienta classificação', () => {
    const issues = validateNfePayload(validPayload({}, { codigo_ncm: '00000000' }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '778' })]);
  });

  it('CFOP inválido → rej. 511', () => {
    const issues = validateNfePayload(validPayload({}, { cfop: '9999' }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '511' })]);
  });

  it('CST IBS/CBS 2xx sem gRed → rej. 1033 (#446)', () => {
    const issues = validateNfePayload(
      validPayload({}, { ibs_cbs_situacao_tributaria: '200' }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: '1033' })]);
  });

  it('CST 2xx com gRed completo passa', () => {
    const issues = validateNfePayload(
      validPayload(
        {},
        {
          ibs_cbs_situacao_tributaria: '200',
          cbs_percentual_reducao_aliquota: 100,
          ibs_uf_percentual_reducao_aliquota: 100,
        },
      ),
    );
    expect(issues).toEqual([]);
  });

  it('veículo sem cmt/distância de eixos → nota sairia sem dados de emplacamento', () => {
    const issues = validateNfePayload(
      validPayload({}, { veiculo_codigo_vin: 'N', veiculo_chassi: '9AD123456789' }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: 'FOCUS-VEIC' })]);
  });

  it('veiculo_serie acima de 9 chars → limite nSerie', () => {
    const issues = validateNfePayload(
      validPayload(
        {},
        {
          veiculo_chassi: '9AD123456789',
          veiculo_cmt: '0.75',
          veiculo_distancia_eixos: 200,
          veiculo_serie: 'SERIEMUITOLONGA',
        },
      ),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: 'FOCUS-VEIC', field: 'items[1].veiculo_serie' })]);
  });

  it('acumula múltiplos problemas e formata mensagem orientada', () => {
    const issues = validateNfePayload(
      validPayload({ data_emissao: '2026-07-06T23:30:00Z', valor_frete: 10 }, { cfop: '99' }),
    );
    expect(issues).toHaveLength(3);
    const msg = formatValidationIssues(issues);
    expect(msg).toMatch(/^Validação pré-transmissão bloqueou a emissão \(3 problemas\)/);
    expect(msg).toContain('[577]');
    expect(msg).toContain('[535]');
    expect(msg).toContain('[511]');
  });
});
