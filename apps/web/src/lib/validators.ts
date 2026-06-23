/**
 * Validadores de documentos brasileiros (algoritmo oficial dos dígitos
 * verificadores). Aceitam com ou sem máscara.
 */

const digits = (v: string): string => (v ?? '').replace(/\D/g, '');

export function isValidCPF(value: string): boolean {
  const cpf = digits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calc = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function isValidCNPJ(value: string): boolean {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calc = (len: number): number => {
    const weights =
      len === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

/** Valida conforme o tipo: INDIVIDUAL → CPF, COMPANY → CNPJ. */
export function isValidDocument(value: string, type: 'INDIVIDUAL' | 'COMPANY'): boolean {
  return type === 'INDIVIDUAL' ? isValidCPF(value) : isValidCNPJ(value);
}
