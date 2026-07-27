/**
 * Redação de PII antes de QUALQUER saída do incidente para fora do banco
 * (issue no GitHub #767; futuramente a triagem por LLM #768). Decisão travada
 * do épico #764: dado do cliente final (documento, contato) nunca sai do
 * tenant — o GitHub recebe só contexto técnico redigido.
 *
 * Estratégia: mascarar os identificadores diretos (CPF, CNPJ, e-mail,
 * telefone com DDD). Na dúvida sobre-redige (um run de 11 dígitos vira [CPF]
 * mesmo que fosse outra coisa). Cuida dos falsos positivos óbvios: protocolo
 * AVQ-000123 e versões (v1.18.0) NÃO casam nenhum padrão.
 *
 * Ordem importa:
 *  1. e-mail primeiro (senão o "@dominio.com" sobra bagunçado).
 *  2. CNPJ (14) antes de CPF (11): num run pelado de 14 dígitos o CPF casaria
 *     os 11 primeiros e deixaria lixo — CNPJ tem que consumir o run inteiro.
 *  3. telefone por último: um CPF pelado (11 díg.) também casa o padrão de
 *     telefone, então o CPF precisa mascarar antes.
 */
export function redactPii(text: string): string {
  if (!text) return text;
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[EMAIL]')
    .replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, '[CNPJ]')
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '[CPF]')
    .replace(/\(?\d{2}\)?\s?\d{4,5}-?\d{4}/g, '[TELEFONE]');
}
