import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface BuildMeta {
  version: string;
  gitSha: string;
  builtAt: string;
}

let cached: BuildMeta | null = null;

/**
 * Metadados de build da API (#versioning). Resiliente: nunca lança.
 * - `version`: sempre do package.json (fonte da verdade do SemVer).
 * - `gitSha`/`builtAt`: do build-info.json estampado no deploy (`npm run deploy:api`);
 *   'unknown' quando não estampado (ex.: dev local, testes).
 */
export function readBuildMeta(): BuildMeta {
  if (cached) return cached;

  let version = '0.0.0';
  let gitSha = 'unknown';
  let builtAt = 'unknown';

  try {
    const pkgPath = join(process.cwd(), 'package.json');
    if (existsSync(pkgPath)) {
      version = JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? version;
    }
  } catch {
    /* mantém fallback */
  }

  try {
    const infoPath = join(process.cwd(), 'build-info.json');
    if (existsSync(infoPath)) {
      const info = JSON.parse(readFileSync(infoPath, 'utf8'));
      gitSha = info.gitSha ?? gitSha;
      builtAt = info.builtAt ?? builtAt;
    }
  } catch {
    /* mantém fallback */
  }

  cached = { version, gitSha, builtAt };
  return cached;
}
