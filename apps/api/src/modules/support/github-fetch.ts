/**
 * POST autenticado à API do GitHub com timeout via AbortController — o padrão
 * fetch-nativo do suporte (#767/#768). Extraído do GithubIssueService para ser
 * reusado pelo TriageProcessor (repository_dispatch) sem duplicar cabeçalhos.
 *
 * Fire-and-forget por design: quem chama trata a resposta/erro; este helper
 * nunca segura o fluxo do incidente (timeout curto).
 */
export const GITHUB_DEFAULT_TIMEOUT_MS = 10_000;

export function githubPost(
  url: string,
  token: string,
  body: unknown,
  timeoutMs: number = GITHUB_DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}
