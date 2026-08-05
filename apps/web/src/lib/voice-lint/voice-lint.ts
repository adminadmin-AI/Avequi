import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import * as ts from 'typescript';

/**
 * Voice Lint — Onda 4 do épico #987, espírito do tenant-query-lint da API.
 *
 * Análise ESTÁTICA (AST do TypeScript): encontra, em STRINGS do apps/web
 * (literais, templates e texto JSX), os padrões de escrita que o glossário
 * avecchi-voice baniu — travessão, jargão de engenharia, termos aposentados
 * ("Pagáveis", "OV", "kill switch") e as frases de máquina que as Ondas 1-3
 * erradicaram. O objetivo é REGRESSÃO: tela nova que reintroduzir o vício
 * quebra o CI, igual query sem tenant quebra na API.
 *
 * ── O que NÃO é flagrado ─────────────────────────────────────────────────────
 *  - comentários (não são strings) e nomes de variável/função/rota;
 *  - strings SEM espaço (paths, keys, classes CSS) — nelas só vale a lista
 *    EXACT_BANNED (rótulo de uma palavra só, ex.: 'Dashboard');
 *  - argumentos de console.* (log de dev, não é UI);
 *  - o glifo '—' sozinho ('—' / '— ') — placeholder de valor vazio e
 *    indentação de árvore, convenções legítimas;
 *  - meia-risca (–) de intervalos.
 *
 * ── Waiver ───────────────────────────────────────────────────────────────────
 *  `// voice-lint: ok (<motivo>)` na linha da string ou na imediatamente
 *  acima — sempre com motivo, revisável em code review.
 */

/** Padrões banidos em strings de PROSA (contêm espaço). Fonte: SKILL.md. */
export const BANNED_PATTERNS: Array<{ re: RegExp; motivo: string }> = [
  { re: /—/, motivo: 'travessão em texto de UI (use subtítulo, parênteses, dois-pontos ou reescreva)' },
  { re: /\bkill ?switch\b/i, motivo: 'jargão interno — escreva a ação real (ex.: "Desligar SDR")' },
  { re: /\btakeover\b/i, motivo: 'anglicismo banido — "assumir a conversa"' },
  { re: /\bendpoint\b/i, motivo: 'jargão de engenharia em texto visível' },
  { re: /\bbackend\b/i, motivo: 'jargão de engenharia em texto visível' },
  { re: /\(#\d+\)/, motivo: 'número de issue do GitHub em texto visível' },
  { re: /não foi possível executar a ação/i, motivo: 'erro genérico de máquina — use erroDeAcao(ação, e)' },
  { re: /ocorreu um erro inesperado/i, motivo: 'erro genérico de máquina — use a fórmula da skill' },
  { re: /\bstatus atualizado\b/i, motivo: 'sucesso genérico — nomeie o objeto e o que aconteceu' },
  { re: /\bpagáve(l|is)\b/i, motivo: 'calque de payables — a entidade é "título"; a tela é "Contas a pagar"' },
  { re: /\brecebíve(l|is)\b/i, motivo: 'calque de receivables — a entidade é "título"; a tela é "Contas a receber"' },
  { re: /\borde(m|ns) de venda\b/i, motivo: 'vocabulário aposentado — módulo "Vendas", entidade "pedido de venda"' },
  { re: /\bOV\b/, motivo: 'sigla aposentada — "Pedido #X"' },
  { re: /\baging\b/i, motivo: 'anglicismo banido — "faixas de atraso"' },
  { re: /\blead ?time\b/i, motivo: 'anglicismo banido — "prazo de entrega"' },
];

/** Rótulos de uma palavra só, banidos por igualdade exata (strings sem espaço). */
export const EXACT_BANNED: Array<{ texto: string; motivo: string }> = [
  { texto: 'Dashboard', motivo: 'anglicismo banido — "Painel"' },
  { texto: 'Analytics', motivo: 'anglicismo banido — "Indicadores"' },
  { texto: 'Inbox', motivo: 'anglicismo banido — "Conversas"' },
  { texto: 'Billing', motivo: 'anglicismo banido — "Cobrança"' },
  { texto: 'Erro', motivo: 'toast de uma palavra — diga o que houve e o que fazer' },
];

const WAIVER = /voice-lint:\s*ok\s*\((.+?)\)/;

export interface VoiceLintOffender {
  file: string; // relativo ao dir varrido
  line: number; // 1-indexed
  texto: string; // trecho da string flagrada (truncado)
  motivo: string;
}

/** Glifos legítimos: placeholder de valor vazio e indentação de árvore. */
function ehGlifoPermitido(texto: string): boolean {
  return texto === '—' || texto === '— ' || texto === ' — ';
}

function linhaTemWaiver(linhas: string[], linha1: number): boolean {
  const atual = linhas[linha1 - 1] ?? '';
  const anterior = linhas[linha1 - 2] ?? '';
  return WAIVER.test(atual) || WAIVER.test(anterior);
}

function checarTexto(texto: string): { motivo: string } | null {
  if (ehGlifoPermitido(texto)) return null;
  const temEspaco = /\s/.test(texto.trim()) && texto.trim().includes(' ');
  if (temEspaco) {
    for (const { re, motivo } of BANNED_PATTERNS) {
      if (re.test(texto)) return { motivo };
    }
    return null;
  }
  // sem espaço: path/key/classe — só rótulos exatos de uma palavra
  for (const { texto: banido, motivo } of EXACT_BANNED) {
    if (texto === banido) return { motivo };
  }
  // travessão embutido em string sem espaço (ex.: 'a—b') continua proibido
  if (texto.includes('—')) {
    return { motivo: 'travessão em texto de UI' };
  }
  return null;
}

function ehChamadaConsole(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'console'
  );
}

/** Varre o SOURCE de um arquivo e devolve os ofensores (file fica vazio). */
export function checarSource(source: string, fileName = 'inline.tsx'): VoiceLintOffender[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const linhas = source.split('\n');
  const ofensores: VoiceLintOffender[] = [];

  function flag(node: ts.Node, texto: string) {
    const resultado = checarTexto(texto);
    if (!resultado) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const linha1 = line + 1;
    if (linhaTemWaiver(linhas, linha1)) return;
    ofensores.push({
      file: '',
      line: linha1,
      texto: texto.length > 80 ? `${texto.slice(0, 77)}...` : texto,
      motivo: resultado.motivo,
    });
  }

  function visitar(node: ts.Node) {
    if (ehChamadaConsole(node)) return; // log de dev, não é UI
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      flag(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      // junta SEM separador: template de rota (`/a/${id}/b`) continua "sem
      // espaço" e cai na regra de path; prosa real já tem espaços próprios
      flag(node, [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(''));
    } else if (ts.isJsxText(node)) {
      const texto = node.text.trim();
      if (texto) flag(node, texto);
    }
    ts.forEachChild(node, visitar);
  }

  visitar(sf);
  return ofensores;
}

function listarArquivos(dir: string): string[] {
  const resultado: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      if (entrada === 'node_modules' || entrada === 'voice-lint') continue;
      resultado.push(...listarArquivos(caminho));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entrada) || /\.spec\.(ts|tsx)$/.test(entrada)) continue;
    resultado.push(caminho);
  }
  return resultado;
}

/** Varre diretórios inteiros (caminhos absolutos); paths no resultado saem relativos a `base`. */
export function checarDiretorios(dirs: string[], base: string): VoiceLintOffender[] {
  const ofensores: VoiceLintOffender[] = [];
  for (const dir of dirs) {
    for (const arquivo of listarArquivos(dir)) {
      const encontrados = checarSource(
        readFileSync(arquivo, 'utf8'),
        arquivo.endsWith('.tsx') ? 'a.tsx' : 'a.ts',
      );
      const rel = relative(base, arquivo).split(sep).join('/');
      for (const o of encontrados) ofensores.push({ ...o, file: rel });
    }
  }
  return ofensores;
}
