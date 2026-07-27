import { redactPii } from './redact-pii';

describe('redactPii', () => {
  it.each([
    // e-mail
    ['fale com joao.silva+x@gdr.com.br agora', 'fale com [EMAIL] agora'],
    // CPF formatado e pelado
    ['CPF 123.456.789-01', 'CPF [CPF]'],
    ['CPF 12345678901', 'CPF [CPF]'],
    // CNPJ formatado e pelado
    ['CNPJ 12.345.678/0001-90', 'CNPJ [CNPJ]'],
    ['CNPJ 12345678000190', 'CNPJ [CNPJ]'],
    // telefone BR com DDD (celular e fixo, com/sem parênteses)
    ['tel (42) 99999-8888', 'tel [TELEFONE]'],
    ['tel (42) 3333-4444', 'tel [TELEFONE]'],
    ['tel 42 99999-8888', 'tel [TELEFONE]'],
  ])('mascara %s → %s', (input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });

  it('redige múltiplos PIIs na mesma string', () => {
    const out = redactPii(
      'Cliente joao@gdr.com.br, CPF 123.456.789-01, CNPJ 12.345.678/0001-90, fone (42) 99999-8888',
    );
    expect(out).toBe(
      'Cliente [EMAIL], CPF [CPF], CNPJ [CNPJ], fone [TELEFONE]',
    );
    expect(out).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(out).not.toMatch(/@gdr/);
  });

  it('NÃO mascara protocolo AVQ-000123 nem versões (falsos positivos)', () => {
    const s = 'Protocolo AVQ-000123 na versão v1.18.0 rota /app/sales status 500';
    expect(redactPii(s)).toBe(s);
  });

  it('preserva texto técnico sem PII (ids curtos, requestId)', () => {
    const s = 'Pedido 1234 falhou (requestId req-9) — retry 3x';
    expect(redactPii(s)).toBe(s);
  });

  it('é seguro com string vazia', () => {
    expect(redactPii('')).toBe('');
  });
});
