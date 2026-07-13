import * as https from 'https';
import axios, { AxiosInstance } from 'axios';

/**
 * Cliente HTTP dos WS do SERPRO (#529/#530) — mTLS com certificado e-CNPJ de
 * máquina (exigência do RENAVE-WS; dicas-ssl no manual).
 *
 * O certificado chega por env em base64 (RENAVE_CERT_PFX_BASE64 +
 * RENAVE_CERT_PASSPHRASE) — padrão de secret do Railway, sem arquivo em disco.
 * Sem certificado configurado o client é criado SEM agent mTLS: as chamadas
 * falharão no provider com o contrato de erro brando (`status: 'erro'`), o que
 * mantém a suíte e o dev local funcionando com a flag desligada (#532).
 */
export function buildSerproClient(baseURL: string, timeoutMs = 30_000): AxiosInstance {
  const pfxBase64 = process.env.RENAVE_CERT_PFX_BASE64;
  const passphrase = process.env.RENAVE_CERT_PASSPHRASE;

  const httpsAgent = pfxBase64
    ? new https.Agent({
        pfx: Buffer.from(pfxBase64, 'base64'),
        passphrase: passphrase || undefined,
        keepAlive: true,
      })
    : undefined;

  return axios.create({
    baseURL,
    timeout: timeoutMs,
    ...(httpsAgent && { httpsAgent }),
    headers: { 'Content-Type': 'application/json' },
    // 4xx tratado como resposta (motivo/código do provider), não exceção;
    // 5xx/timeout viram exceção e caem no catch do adapter → 'erro'
    validateStatus: (s) => s < 500,
  });
}

/** Remove campos sensíveis do retorno antes de persistir no ledger (LGPD #527) */
export function sanitizeProviderResponse(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') return { value: String(data ?? '') };
  const SENSITIVE = /cpf|cnpj|token|authorization|senha|password|certificado/i;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE.test(key)) {
      out[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = sanitizeProviderResponse(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
