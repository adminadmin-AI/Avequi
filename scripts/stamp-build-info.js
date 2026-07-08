#!/usr/bin/env node
/**
 * #versioning — estampa apps/api/build-info.json com o commit e a data do build.
 * Roda ANTES do `railway up` (o .dockerignore exclui .git, então o SHA precisa
 * entrar pelo build context). Chamado por `npm run deploy:api`.
 */
const { execSync } = require('child_process');
const { writeFileSync, readFileSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');

let gitSha = 'unknown';
try {
  gitSha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
} catch {
  /* fora de um repo git — mantém unknown */
}

let version = '0.0.0';
try {
  version = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8')).version ?? version;
} catch {
  /* mantém fallback */
}

const info = { version, gitSha, builtAt: new Date().toISOString() };
writeFileSync(join(root, 'apps/api/build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log('[stamp:build] apps/api/build-info.json →', JSON.stringify(info));
