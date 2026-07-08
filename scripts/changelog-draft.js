#!/usr/bin/env node
/**
 * #versioning — rascunho automático de CHANGELOG a partir dos commits/PRs na
 * main desde a última tag `vX.Y.Z` (por ancestralidade: `git log vX.Y.Z..HEAD`).
 *
 *   npm run changelog:draft            # imprime o rascunho (revisar)
 *   npm run changelog:draft -- --write # insere na seção [Unreleased] do CHANGELOG.md
 *
 * Usa os assuntos dos commits de squash-merge (que já vêm como "<título do PR>
 * (#NNN)"), agrupa por heurística (Added / Fixed / Changed) e é um RASCUNHO —
 * sempre revise/edite antes do release (`npm run release:*`). Só depende de git.
 */
const { execSync } = require('child_process');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const write = process.argv.includes('--write');

const sh = (cmd, ok = false) => {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    if (ok) return '';
    throw e;
  }
};

// Garante que as tags remotas estejam locais (best-effort; offline não quebra).
sh('git fetch --tags --quiet', true);

// ─── Range desde a última tag ────────────────────────────────────────────────
const lastTag = sh("git describe --tags --match 'v*' --abbrev=0", true) || null;
const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
if (!lastTag) console.warn('! Nenhuma tag v* — listando todo o histórico da main.');

// Assuntos dos commits no range (um por PR no fluxo de squash-merge)
const subjects = sh(`git log ${range} --format=%s`)
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((s) => !/^chore\(release\)/i.test(s)); // ignora o próprio commit de release

// ─── Categorização (por assunto) ─────────────────────────────────────────────
function categorize(s) {
  const t = s.toLowerCase();
  if (/^fix|^hotfix|\bfix\(|\bbug\b/.test(t)) return 'Fixed';
  if (/^(chore|refactor|docs|style|perf|test|ci|build)/.test(t)) return 'Changed';
  return 'Added'; // padrão: a maioria dos PRs deste repo são features
}

const groups = { Added: [], Fixed: [], Changed: [] };
for (const s of subjects) groups[categorize(s)].push(`- ${s}`);

// ─── Markdown ────────────────────────────────────────────────────────────────
const sections = [];
for (const key of ['Added', 'Fixed', 'Changed']) {
  if (groups[key].length) sections.push(`### ${key}\n${groups[key].join('\n')}`);
}
const bodyMd = sections.length ? sections.join('\n\n') : '_Nenhum commit novo desde a última tag._';
const sinceLabel = lastTag ? `desde ${lastTag}` : '(todo o histórico)';

if (!write) {
  console.log(`\n## Rascunho de CHANGELOG — ${sinceLabel} (${subjects.length} commits)\n`);
  console.log(bodyMd);
  console.log(`\n(revise e rode com --write para inserir em [Unreleased])\n`);
  process.exit(0);
}

// ─── --write: insere na seção [Unreleased] ───────────────────────────────────
const clPath = join(root, 'CHANGELOG.md');
if (!existsSync(clPath)) {
  console.error('! CHANGELOG.md não encontrado.');
  process.exit(1);
}
const cl = readFileSync(clPath, 'utf8');
const marker = '## [Unreleased]';
const i = cl.indexOf(marker);
if (i === -1) {
  console.error('! Seção [Unreleased] não encontrada no CHANGELOG.md.');
  process.exit(1);
}
const after = i + marker.length;
const nextSection = cl.indexOf('\n## [', after);
const boundary = nextSection === -1 ? cl.length : nextSection;
const out = `${cl.slice(0, after)}\n\n${bodyMd}\n${cl.slice(boundary)}`;
writeFileSync(clPath, out);
console.log(`CHANGELOG.md: [Unreleased] atualizado (${subjects.length} commits ${sinceLabel}). Revise antes do release.`);
