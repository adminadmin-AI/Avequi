/**
 * #695 — registra o webhook fiscal na Focus para UMA empresa (hooks são por
 * CNPJ/token na conta Focus; mesma URL/secret para todas).
 *
 * Uso (uma vez por CNPJ emissor, com o token DAQUELA empresa):
 *   FOCUS_TOKEN=<token da empresa> \
 *   WEBHOOK_URL=https://api.avecchi.ai/api/fiscal/webhook \
 *   WEBHOOK_SECRET=<mesmo FOCUS_NFE_WEBHOOK_SECRET do Railway> \
 *   FOCUS_BASE_URL=https://api.focusnfe.com.br \
 *   npx ts-node scripts/register-focus-webhook.ts
 *
 * ⚠️ O hook JÁ REGISTRADO na conta Focus aponta para o domínio antigo
 * (`avequi-api-production.up.railway.app`), que continua ativo e entregando
 * normalmente. Re-registrar no domínio novo é tarefa à parte: rodar este
 * script substitui o hook do evento, então precisa ser feito com a conferência
 * do GET /v2/hooks depois — e nunca junto de outra mudança de produção.
 *
 * Mesmo fluxo validado no dry-run de 06/07 (hook 2RLPpbzR): POST /v2/hooks
 * aceita `authorization` + `authorization_header` p/ header customizado
 * (o webhook do ERP valida x-focus-token — fail-closed).
 */
import axios from 'axios';

async function main() {
  const token = process.env.FOCUS_TOKEN;
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  const baseUrl = process.env.FOCUS_BASE_URL ?? 'https://homologacao.focusnfe.com.br';

  if (!token || !url || !secret) {
    console.error('Defina FOCUS_TOKEN, WEBHOOK_URL e WEBHOOK_SECRET.');
    process.exit(1);
  }

  const events = ['nfe', 'nfce'];
  for (const event of events) {
    const { data } = await axios.post(
      `${baseUrl}/v2/hooks`,
      { url, event, authorization: secret, authorization_header: 'x-focus-token' },
      { auth: { username: token, password: '' } },
    );
    console.log(`hook ${event}: id=${data.id ?? JSON.stringify(data)}`);
  }

  const { data: hooks } = await axios.get(`${baseUrl}/v2/hooks`, {
    auth: { username: token, password: '' },
  });
  console.log(`hooks ativos desta empresa: ${JSON.stringify(hooks)}`);
}

main().catch((err) => {
  console.error('Falha ao registrar webhook:', err.response?.data ?? err.message);
  process.exit(1);
});
