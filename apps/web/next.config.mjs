import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// #versioning — expõe a versão do produto (package.json) pro app em build time
const here = dirname(fileURLToPath(import.meta.url));
const appVersion = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  /**
   * Cabeçalhos de segurança do ERP. O Helmet cobre a API (Railway); o app
   * em si (Vercel) não tinha nenhum — nem X-Frame-Options, ou seja, a
   * interface inteira podia ser embutida num iframe de terceiro
   * (clickjacking sobre telas que aprovam pedido e liberam pagamento).
   *
   * Sem CSP nesta primeira leva de propósito: o Next injeta script inline
   * (hidratação, next-themes) e uma política escrita no escuro quebraria a
   * aplicação em produção. CSP entra depois, com nonce, medida em
   * Report-Only — mesmo caminho que a API está seguindo.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Efetivo só sob TLS; a Vercel serve tudo em HTTPS.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // F1 Profundidade: árvore legada /dashboard/** removida (era pré-design
      // system e não tinha nenhuma referência de navegação). URLs antigas em
      // favoritos caem no app atual.
      {
        source: '/dashboard/:path*',
        destination: '/app',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
