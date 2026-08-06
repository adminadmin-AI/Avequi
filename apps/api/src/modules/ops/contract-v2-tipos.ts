/**
 * #1025/#992 — Tipos do documento AVQ-CT v2 (contrato do parceiro jurídico do
 * Claudio, implantado em 05/08/2026 por transcrição fiel do PDF aprovado).
 *
 * Estrutura: capítulos com blocos (parágrafo corrido ou tabela). Os textos
 * vivem em contract-v2-texto-*.ts; os anexos em contract-v2-anexos.ts.
 */

export type Bloco =
  | { tipo: 'par'; texto: string }
  | { tipo: 'tabela'; colunas: string[]; linhas: string[][] };

export interface Capitulo {
  titulo: string;
  blocos: Bloco[];
}

/** Marcador de dado cadastral pendente — NUNCA inventar dado em contrato. */
export const PENDENTE = '[PREENCHER NO CADASTRO DA EMPRESA]';

export interface ContratoV2Params {
  operadora: {
    razaoSocial: string;
    cnpj: string;
    im: string | null;
    endereco: string | null;
    email: string | null;
    /** cidade/UF da sede — alimenta foro e local de assinatura */
    comarca: string | null;
  };
  cliente: {
    razaoSocial: string;
    cnpj: string;
    endereco: string | null;
    email: string | null;
  };
  comercial: {
    mensalidadeFormatada: string;
    mensalidadePorExtenso: string | null;
    diaCobranca: number;
    inicioVigencia: string;
    planoNome: string | null;
    propostaAceita: { id: string; decididaEm: string } | null;
  };
}

export const par = (texto: string): Bloco => ({ tipo: 'par', texto });
export const tabela = (colunas: string[], linhas: string[][]): Bloco => ({
  tipo: 'tabela',
  colunas,
  linhas,
});
