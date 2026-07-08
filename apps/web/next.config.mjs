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
};

export default nextConfig;
