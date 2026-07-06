/**
 * Consulta de dados públicos para auto-preenchimento de cadastro (#474) —
 * equivalente ao "Pesquisar SEFAZ" do Omie.
 *
 * - CEP: ViaCEP (https://viacep.com.br) — endereço + código IBGE
 * - CNPJ: BrasilAPI (https://brasilapi.com.br) — razão social, endereço, contato
 *
 * Ambas as APIs são públicas, sem chave e com CORS liberado para o browser.
 */

export interface CepLookupResult {
  address: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  ibgeCode: string;
}

export interface CnpjLookupResult {
  razaoSocial: string;
  nomeFantasia: string;
  email: string;
  phone: string;
  zipCode: string;
  address: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  ibgeCode: string;
  isSimplesNacional: boolean | null;
}

// Limites das colunas no schema (Customer/CustomerAddress) — a Receita devolve
// complementos como "ANDAR T I SL S101 A S1602..." que estouram VarChar(60)
const clamp = (v: string, max: number) => v.slice(0, max);

/** Busca endereço por CEP (8 dígitos). Retorna null se não encontrado. */
export async function lookupCep(cep: string): Promise<CepLookupResult | null> {
  const digits = cep.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.erro) return null;
  return {
    address: data.logradouro ?? '',
    complement: clamp(data.complemento ?? '', 60),
    neighborhood: clamp(data.bairro ?? '', 60),
    city: data.localidade ?? '',
    state: data.uf ?? '',
    ibgeCode: data.ibge ?? '',
  };
}

/** Busca dados cadastrais por CNPJ (14 dígitos). Retorna null se não encontrado. */
export async function lookupCnpj(cnpj: string): Promise<CnpjLookupResult | null> {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return null;
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    razaoSocial: data.razao_social ?? '',
    nomeFantasia: data.nome_fantasia ?? '',
    email: data.email ?? '',
    phone: data.ddd_telefone_1 ?? '',
    zipCode: String(data.cep ?? '').replace(/\D/g, ''),
    address: data.logradouro ?? '',
    number: clamp(data.numero ?? '', 10),
    complement: clamp(data.complemento ?? '', 60),
    neighborhood: clamp(data.bairro ?? '', 60),
    city: data.municipio ?? '',
    state: data.uf ?? '',
    ibgeCode: data.codigo_municipio_ibge ? String(data.codigo_municipio_ibge) : '',
    isSimplesNacional: data.opcao_pelo_simples ?? null,
  };
}
