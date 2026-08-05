import { ehNegativaDeAcesso, mensagemDoErro } from './api-error';

/**
 * Mensagens de feedback no padrão avecchi-voice (#987, Onda 2).
 *
 * Antes cada tela inventava seu fallback ("Erro ao X", "Falha no takeover",
 * "Não foi possível executar a ação") — dezenas de variações do mesmo timbre
 * de máquina. Aqui vive a fórmula única: o que houve + o que fazer, com a
 * mensagem do backend vencendo quando existe e é apresentável.
 *
 * Uso: `toast.error(erroDeAcao('mover o lead', e))`. A ação vai no
 * infinitivo COM objeto ("salvar a resposta rápida", "emitir a NF-e") —
 * nunca genérica ("executar a ação").
 */
export function erroDeAcao(acao: string, erro?: unknown): string {
  const doServidor = mensagemDoErro(erro);
  if (doServidor) return doServidor;
  if (erro !== undefined && ehNegativaDeAcesso(erro)) {
    return `Você não tem permissão para ${acao}.`;
  }
  return `Não conseguimos ${acao}. Tente de novo. Se continuar, avise o suporte.`;
}
