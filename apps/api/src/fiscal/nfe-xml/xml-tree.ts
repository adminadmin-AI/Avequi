/**
 * Árvore XML mínima e determinística — SEM dependência externa.
 *
 * Por que não regex sobre o texto: o XML da NF-e repete o mesmo nome de tag em
 * grupos diferentes (`CNPJ`/`xNome`/`IE` em <emit>, <dest>, <transporta>;
 * `CST`/`vBC` em ICMS/PIS/COFINS; `nProt` em <protNFe> e em eventos). Só uma
 * árvore de verdade permite ler "o vBC do PIS do item 3" sem ambiguidade.
 *
 * Escopo deliberadamente pequeno (o suficiente para NF-e 4.00 e eventos):
 *  - prólogo, comentários, CDATA, instruções de processamento: ignorados/lidos;
 *  - atributos (com aspas simples ou duplas);
 *  - namespaces: o prefixo é descartado (`ns:tag` → `tag`), o atributo
 *    `xmlns*` é mantido como atributo comum;
 *  - entidades predefinidas (&amp; &lt; &gt; &quot; &apos;) e numéricas
 *    (&#nn; &#xhh;) decodificadas no texto e nos atributos;
 *  - texto misto é concatenado em `text` (a NF-e não usa conteúdo misto).
 *
 * Erros estruturais (tag fechada fora de ordem, EOF dentro de tag) lançam
 * XmlParseError — um arquivo truncado NÃO vira uma nota "meio lida".
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export class XmlParseError extends Error {
  constructor(message: string, public readonly offset: number) {
    super(`${message} (offset ${offset})`);
    this.name = 'XmlParseError';
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return body in ENTITIES ? ENTITIES[body] : whole;
  });
}

function stripPrefix(name: string): string {
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}

/** Faz o parse e devolve o elemento raiz. */
export function parseXml(input: string): XmlNode {
  // BOM
  const xml = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = xml.length;

  const fail = (msg: string): never => {
    throw new XmlParseError(msg, i);
  };

  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      const tail = xml.slice(i);
      if (tail.trim() !== '') stack[stack.length - 1].text += decodeEntities(tail);
      break;
    }
    if (lt > i) {
      const chunk = xml.slice(i, lt);
      if (chunk.trim() !== '') stack[stack.length - 1].text += decodeEntities(chunk);
    }
    i = lt;

    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end === -1) fail('comentário sem fechamento');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end === -1) fail('CDATA sem fechamento');
      stack[stack.length - 1].text += xml.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end === -1) fail('instrução de processamento sem fechamento');
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!', i)) {
      // DOCTYPE e afins — não esperados em NF-e; pulamos até o '>' correspondente.
      const end = xml.indexOf('>', i + 2);
      if (end === -1) fail('declaração sem fechamento');
      i = end + 1;
      continue;
    }
    if (xml.startsWith('</', i)) {
      const end = xml.indexOf('>', i + 2);
      if (end === -1) fail('tag de fechamento sem ">"');
      const name = stripPrefix(xml.slice(i + 2, end).trim());
      const top = stack[stack.length - 1];
      if (stack.length === 1 || top.name !== name) {
        fail(`fechamento </${name}> não corresponde a <${top.name}>`);
      }
      stack.pop();
      i = end + 1;
      continue;
    }

    // Tag de abertura (ou auto-fechada)
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(xml[j])) j++;
    if (j === i + 1) fail('nome de tag vazio');
    const node: XmlNode = { name: stripPrefix(xml.slice(i + 1, j)), attrs: {}, children: [], text: '' };

    // atributos
    let selfClosing = false;
    for (;;) {
      while (j < n && /\s/.test(xml[j])) j++;
      if (j >= n) fail('EOF dentro de tag');
      if (xml[j] === '>') {
        j++;
        break;
      }
      if (xml[j] === '/') {
        if (xml[j + 1] !== '>') fail('"/" inesperado dentro de tag');
        selfClosing = true;
        j += 2;
        break;
      }
      let k = j;
      while (k < n && !/[\s=/>]/.test(xml[k])) k++;
      const attrName = xml.slice(j, k);
      if (!attrName) fail('atributo sem nome');
      let m = k;
      while (m < n && /\s/.test(xml[m])) m++;
      if (xml[m] !== '=') fail(`atributo ${attrName} sem "="`);
      m++;
      while (m < n && /\s/.test(xml[m])) m++;
      const quote = xml[m];
      if (quote !== '"' && quote !== "'") fail(`valor do atributo ${attrName} sem aspas`);
      const close = xml.indexOf(quote, m + 1);
      if (close === -1) fail(`atributo ${attrName} sem aspas de fechamento`);
      node.attrs[stripPrefix(attrName)] = decodeEntities(xml.slice(m + 1, close));
      j = close + 1;
    }

    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = j;
  }

  if (stack.length !== 1) fail(`EOF com ${stack.length - 1} tag(s) aberta(s): <${stack[stack.length - 1].name}>`);
  if (root.children.length !== 1) fail(`documento deve ter exatamente 1 raiz (encontrado ${root.children.length})`);
  return root.children[0];
}

// ─── Navegação ───────────────────────────────────────────────────────────────

/** Primeiro filho direto com o nome (ou undefined). */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

/** Todos os filhos diretos com o nome. */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Caminho de filhos diretos: path(node, 'ide', 'nNF'). */
export function path(node: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  let cur = node;
  for (const nm of names) {
    cur = child(cur, nm);
    if (!cur) return undefined;
  }
  return cur;
}

/** Texto (trim) de um caminho; null quando ausente ou vazio. */
export function text(node: XmlNode | undefined, ...names: string[]): string | null {
  const t = (names.length ? path(node, ...names) : node)?.text.trim() ?? '';
  return t === '' ? null : t;
}

/** Busca em profundidade o primeiro descendente com o nome. */
export function findFirst(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined;
  for (const c of node.children) {
    if (c.name === name) return c;
    const deep = findFirst(c, name);
    if (deep) return deep;
  }
  return undefined;
}
