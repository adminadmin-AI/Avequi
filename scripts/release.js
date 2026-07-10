#!/usr/bin/env node
/**
 * #versioning — bump de versão do produto (SemVer).
 *
 *   npm run release:patch | release:minor | release:major [-- --dry-run]
 *
 * O que faz: incrementa a versão nos 4 package.json (raiz, api, web, shared) e
 * prepara o CHANGELOG.md (move o conteúdo de [Unreleased] para a nova seção e
 * ajusta os links de comparação).
 *
 * O que NÃO faz (de propósito — siga docs/VERSIONING.md): commit, tag, push,
 * release ou deploy. Isso é decisão consciente: bump → PR → merge → tag → deploy.
 */
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { execSync } = require('child_process');
const { join } = require('path');

const root = join(__dirname, '..');
const REPO = 'https://github.com/adminadmin-AI/Avequi';
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
];

const args = process.argv.slice(2);
const type = args.find((a) => ['patch', 'minor', 'major'].includes(a));
const dryRun = args.includes('--dry-run');

if (!type) {
  console.error('Uso: node scripts/release.js <patch|minor|major> [--dry-run]');
  process.exit(1);
}

// ─── Versão atual → próxima ──────────────────────────────────────────────────
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const cur = rootPkg.version;
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(cur);
if (!m) {
  console.error(`Versão atual inválida em package.json: "${cur}" (esperado X.Y.Z)`);
  process.exit(1);
}
const [MA, MI, PA] = [Number(m[1]), Number(m[2]), Number(m[3])];
const next =
  type === 'major' ? `${MA + 1}.0.0` : type === 'minor' ? `${MA}.${MI + 1}.0` : `${MA}.${MI}.${PA + 1}`;
const date = new Date().toISOString().slice(0, 10);

console.log(`\n  release ${type}:  ${cur}  →  ${next}   (${date})\n`);

// ─── package.json (x4) ───────────────────────────────────────────────────────
for (const rel of PKGS) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    console.warn(`  ! ${rel} não encontrado — pulado`);
    continue;
  }
  const j = JSON.parse(readFileSync(p, 'utf8'));
  console.log(`  ${dryRun ? '[dry] ' : ''}${rel}: ${j.version} → ${next}`);
  if (!dryRun) {
    j.version = next;
    writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  }
}

// ─── package-lock.json (sincroniza as versões dos workspaces) ────────────────
// Sem isso o lock fica pra trás (aconteceu na 1.2.0→1.4.1) e o drift só aparece
// no próximo npm install de alguém.
if (!dryRun) {
  console.log('  package-lock.json: sincronizando (npm install --package-lock-only)…');
  try {
    execSync('npm install --package-lock-only --ignore-scripts', { cwd: root, stdio: 'pipe' });
    console.log(`  package-lock.json: ${cur} → ${next}`);
  } catch (err) {
    console.warn(`  ! package-lock.json não sincronizado (${err.message}) — rode npm install --package-lock-only manualmente`);
  }
} else {
  console.log('  [dry] package-lock.json: seria sincronizado');
}

// ─── CHANGELOG.md ────────────────────────────────────────────────────────────
const clPath = join(root, 'CHANGELOG.md');
if (existsSync(clPath)) {
  const cl = readFileSync(clPath, 'utf8');
  const result = updateChangelog(cl, next, cur, date);
  if (result.ok) {
    console.log(`  ${dryRun ? '[dry] ' : ''}CHANGELOG.md: nova seção ## [${next}] - ${date}`);
    if (!dryRun) writeFileSync(clPath, result.text);
  } else {
    console.warn(`  ! CHANGELOG.md: ${result.reason} — edite manualmente`);
  }
} else {
  console.warn('  ! CHANGELOG.md não encontrado');
}

// ─── Próximos passos ─────────────────────────────────────────────────────────
console.log(`\n  Próximos passos (docs/VERSIONING.md):`);
console.log(`    1. Revise o CHANGELOG.md (itens da versão ${next}).`);
console.log(`    2. git checkout -b chore/release-${next} && git commit -am "chore(release): ${next}"`);
console.log(`    3. Abra o PR, revise e mergeie na main.`);
console.log(`    4. git tag v${next} && git push origin v${next}  +  gh release create v${next}`);
console.log(`    5. npm run deploy:api   (deploy da API com o novo SHA)\n`);

/**
 * Move o conteúdo de [Unreleased] para uma nova seção versionada e ajusta os
 * links. Defensivo: se o formato esperado não bater, retorna ok:false (não
 * corrompe o arquivo).
 */
function updateChangelog(text, nextV, curV, dateStr) {
  const unrel = '## [Unreleased]';
  const iUnrel = text.indexOf(unrel);
  if (iUnrel === -1) return { ok: false, reason: 'seção [Unreleased] não encontrada' };

  const afterUnrel = iUnrel + unrel.length;
  const iNextSection = text.indexOf('\n## [', afterUnrel);
  const boundary = iNextSection === -1 ? text.length : iNextSection;
  const body = text.slice(afterUnrel, boundary).trim();
  const movedBody = body.length ? body : '_Sem itens listados — edite antes de taggear._';

  const head = text.slice(0, afterUnrel);
  const rest = text.slice(boundary);
  let out = `${head}\n\n## [${nextV}] - ${dateStr}\n\n${movedBody}\n${rest}`;

  // Links no rodapé
  const unrelLink = new RegExp(`\\[Unreleased\\]:\\s*${escapeRe(REPO)}/compare/v${escapeRe(curV)}\\.\\.\\.HEAD`);
  if (unrelLink.test(out)) {
    out = out.replace(unrelLink, `[Unreleased]: ${REPO}/compare/v${nextV}...HEAD`);
  }
  const curLinkLine = new RegExp(`(^\\[${escapeRe(curV)}\\]:.*$)`, 'm');
  if (curLinkLine.test(out)) {
    out = out.replace(curLinkLine, `[${nextV}]: ${REPO}/compare/v${curV}...v${nextV}\n$1`);
  }
  return { ok: true, text: out };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
