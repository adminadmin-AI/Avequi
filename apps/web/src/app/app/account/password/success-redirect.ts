/**
 * Pós-sucesso da troca VOLUNTÁRIA de senha (#736, feedback do smoke v1.15.0):
 * toast de confirmação (com o aviso da desconexão das outras sessões) e
 * volta ao Início. `replace` — não `push` — para o botão Voltar não retornar
 * à tela de troca já concluída.
 *
 * Exclusivo do fluxo voluntário: o fluxo FORÇADO (/change-password) tem o
 * próprio pós-sucesso (login automático) e NÃO usa este helper.
 */
export const VOLUNTARY_SUCCESS_MESSAGE =
  'Senha alterada. Suas outras sessões foram desconectadas.';

export function handleVoluntaryPasswordSuccess(deps: {
  toastSuccess: (message: string) => void;
  replace: (path: string) => void;
}): void {
  deps.toastSuccess(VOLUNTARY_SUCCESS_MESSAGE);
  deps.replace('/app');
}
