import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Sentinela contra shadowing de rota entre controllers (#686, #698).
 *
 * O Express casa rotas na ordem de registro (= ordem dos módulos no
 * app.module.ts). Um controller "pai" com `@Get(':id')` engole a rota raiz de
 * qualquer controller "filho" de prefixo aninhado registrado DEPOIS dele:
 * `GET /fiscal/manifest` virava `fiscal.findOne('manifest')` → 404.
 *
 * Este spec recomputa os pares pai×filho a partir dos metadados REAIS dos
 * controllers e da ordem REAL dos módulos, e falha se qualquer filho estiver
 * registrado depois do pai. Fix padrão: mover o módulo do filho para antes do
 * módulo do pai no app.module.ts (bloco comentado no topo dos imports).
 */

const SRC = join(__dirname, '../..');

function findControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...findControllerFiles(p));
    else if (entry.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

interface CtrlInfo {
  name: string;
  prefix: string; // sem barras nas pontas
  moduleClass: string;
  hasParamGet: boolean; // tem @Get(':algo') de 1 segmento
}

function discover(): { ctrls: CtrlInfo[]; moduleOrder: string[] } {
  const appModuleSrc = readFileSync(join(SRC, 'app.module.ts'), 'utf8');
  // Ordem dos módulos de domínio no array `imports` (4 espaços de indentação)
  const moduleOrder = [...appModuleSrc.matchAll(/^\s{4}(\w+Module),/gm)].map((m) => m[1]);

  const ctrls: CtrlInfo[] = [];
  for (const file of findControllerFiles(join(SRC, 'modules'))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file);
    const dir = join(file, '..');
    const moduleFile = readdirSync(dir).find((f) => f.endsWith('.module.ts'));
    const moduleClass = moduleFile
      ? (readFileSync(join(dir, moduleFile), 'utf8').match(/export class (\w+Module)/)?.[1] ?? '')
      : '';
    for (const cls of Object.values(mod) as any[]) {
      if (typeof cls !== 'function') continue;
      const rawPrefix = Reflect.getMetadata('path', cls);
      if (rawPrefix === undefined) continue;
      let hasParamGet = false;
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        if (name === 'constructor') continue;
        const h = cls.prototype[name];
        if (typeof h !== 'function' || Reflect.getMetadata('path', h) === undefined) continue;
        const path = String(Reflect.getMetadata('path', h)).replace(/^\//, '');
        const isGet = Reflect.getMetadata('method', h) === 0; // RequestMethod.GET
        if (isGet && /^:\w+$/.test(path)) hasParamGet = true;
      }
      ctrls.push({
        name: cls.name,
        prefix: String(rawPrefix).replace(/^\/+|\/+$/g, ''),
        moduleClass,
        hasParamGet,
      });
    }
  }
  return { ctrls, moduleOrder };
}

describe('Shadowing de rota entre controllers (#686/#698)', () => {
  const { ctrls, moduleOrder } = discover();

  it('sanidade: descobriu módulos e controllers', () => {
    expect(moduleOrder.length).toBeGreaterThan(30);
    expect(ctrls.length).toBeGreaterThan(40);
    // os módulos dos controllers precisam existir na ordem lida do app.module
    const known = ctrls.filter((c) => moduleOrder.includes(c.moduleClass));
    expect(known.length).toBeGreaterThan(40);
  });

  it('nenhum controller aninhado registra DEPOIS de um pai com @Get(\':id\')', () => {
    const idx = (m: string) => moduleOrder.indexOf(m);
    const shadowed: string[] = [];
    for (const parent of ctrls.filter((c) => c.hasParamGet && c.prefix)) {
      for (const child of ctrls) {
        if (child === parent || !child.prefix.startsWith(parent.prefix + '/')) continue;
        const extra = child.prefix.slice(parent.prefix.length + 1);
        if (extra.includes('/')) continue; // 2+ segmentos não casam com :id simples
        if (idx(parent.moduleClass) === -1 || idx(child.moduleClass) === -1) continue;
        if (idx(parent.moduleClass) <= idx(child.moduleClass)) {
          shadowed.push(
            `${child.name} [/${child.prefix}] é engolido por ${parent.name}@Get(':id') [/${parent.prefix}] — ` +
              `mova ${child.moduleClass} para ANTES de ${parent.moduleClass} no app.module.ts`,
          );
        }
      }
    }
    expect(shadowed).toEqual([]);
  });
});
