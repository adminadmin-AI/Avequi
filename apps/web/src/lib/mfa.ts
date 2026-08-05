import { mensagemDoErro } from './api-error';

/**
 * MFA self-service (#936) — lógica PURA da tela de Segurança
 * (/app/account/security).
 *
 * Mora aqui, e não dentro dos componentes, porque é exatamente o que o
 * runner do web consegue travar por teste: o vitest do apps/web roda em
 * `environment: 'node'` (sem DOM), então formatação de secret, conteúdo do
 * arquivo de backup codes e tradução de erro ficam fora do React.
 */

/**
 * Abaixo disso a tela avisa que os backup codes estão acabando — com 2 ou
 * menos o usuário está a um par de perdas de celular de ficar trancado fora
 * da conta, e regenerar leva 10 segundos enquanto ele AINDA tem acesso.
 */
export const BACKUP_CODES_MINIMO = 3;

/** Restam poucos backup codes? (aviso warning no card de MFA ativo) */
export function backupCodesEmFalta(restantes: number): boolean {
  return restantes < BACKUP_CODES_MINIMO;
}

/**
 * Secret TOTP em grupos de 4 — para quando a câmera não é opção (desktop sem
 * webcam, QR que o app não lê) e o usuário precisa digitar à mão. Base32 sem
 * separador é o cenário clássico de erro de digitação.
 */
export function agruparSecret(secret: string | null | undefined): string {
  const limpo = (secret ?? '').replace(/\s+/g, '').toUpperCase();
  if (!limpo) return '';
  return limpo.replace(/(.{4})/g, '$1 ').trim();
}

export interface ArquivoDeBackupCodes {
  filename: string;
  content: string;
}

const p2 = (n: number) => String(n).padStart(2, '0');

/**
 * Conteúdo e nome do .txt de backup codes.
 *
 * Os códigos são mostrados UMA única vez (o backend guarda só o hash), então
 * o arquivo precisa se explicar sozinho meses depois, quando for aberto numa
 * pasta de downloads sem nenhum contexto: de qual conta é, quando foi gerado
 * e qual a regra de uso.
 *
 * A data é formatada à mão (sem toLocaleString) para o teste não depender do
 * ICU/locale da máquina que roda o vitest.
 */
export function arquivoDeBackupCodes(
  codes: string[],
  opts: { email?: string | null; geradoEm: Date },
): ArquivoDeBackupCodes {
  const d = opts.geradoEm;
  const dia = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  const hora = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const iso = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

  const largura = String(codes.length).length;
  const linhas = codes.map((code, i) => `${String(i + 1).padStart(largura, ' ')}. ${code}`);

  const content = [
    'Avecchi: backup codes da verificação em duas etapas',
    `Conta: ${opts.email?.trim() || '—'}`,
    `Gerados em: ${dia} ${hora}`,
    '',
    'Cada código funciona UMA única vez, no lugar do código do autenticador.',
    'Guarde este arquivo em local seguro (gerenciador de senhas, cofre, impresso).',
    'Gerar novos códigos invalida TODOS os desta lista.',
    '',
    ...linhas,
    '',
  ].join('\n');

  return { filename: `avecchi-backup-codes-${iso}.txt`, content };
}

/** Códigos em uma linha só — para o "copiar todos". */
export function backupCodesParaClipboard(codes: string[]): string {
  return codes.join('\n');
}

/**
 * Erro de qualquer POST de MFA em uma frase pt-BR.
 *
 * O throttle é o caso que MAIS confunde: 5 tentativas/min e o servidor
 * devolve um 429 seco — sem tradução, o usuário lê "Request failed with
 * status code 429" logo depois de errar o código e acha que quebrou.
 * Fora isso a mensagem do backend é sempre melhor que a nossa (ela sabe se
 * foi senha, código ou ENCRYPTION_KEY ausente no 503).
 */
export function resolveMfaError(erro: unknown, fallback: string): string {
  const status = (erro as { response?: { status?: number } })?.response?.status;
  if (status === 429) {
    return 'Muitas tentativas. Aguarde 1 minuto e tente de novo.';
  }
  const doServidor = mensagemDoErro(erro);
  if (doServidor) return doServidor;
  if (status === 503) {
    return 'O serviço de verificação em duas etapas está indisponível no momento. Tente novamente em instantes.';
  }
  return fallback;
}

/**
 * O 403 que chegou é o do OpsMfaGuard ("O portal da operadora exige MFA…")?
 * Serve para o console oferecer o atalho "Ativar agora" no lugar de um
 * "Acesso negado" sem saída — a negativa é acionável, não definitiva.
 */
export function erroExigeMfa(mensagem: string | null | undefined): boolean {
  return !!mensagem && /MFA/i.test(mensagem);
}
