/**
 * PrismaClient falso para os testes dos seeds — sem banco.
 *
 * - `createFakePrisma(overrides?)`: grava toda chamada `model.method(args)` e
 *   devolve respostas neutras (ou o que `overrides['model.method']` mandar).
 * - `createMemoryPrisma()`: além de gravar, mantém um store em memória com
 *   semântica mínima de where/upsert/create/findMany, suficiente para rodar o
 *   fluxo real `db:seed → db:seed:demo` de ponta a ponta.
 */
export interface RecordedCall {
  model: string;
  method: string;
  args: any;
}

export interface FakePrisma {
  client: any;
  calls: RecordedCall[];
  callsOf(model: string, method?: string): RecordedCall[];
  modelsTouched(): string[];
}

export interface MemoryPrisma extends FakePrisma {
  store: Record<string, any[]>;
  rows(model: string): any[];
}

export type Responder = (args: any) => any;

let seq = 0;
const nextId = (model: string) => `${model}-${++seq}`;

function buildClient(calls: RecordedCall[], respond: (model: string, method: string, args: any) => any): any {
  const client: any = new Proxy(
    {},
    {
      get(_t, model: string) {
        if (model === '$disconnect' || model === '$connect') return async () => undefined;
        if (model === '$transaction') return async (fn: any) => (typeof fn === 'function' ? fn(client) : Promise.all(fn));
        if (typeof model !== 'string' || model.startsWith('then')) return undefined;
        return new Proxy(
          {},
          {
            get(_m, method: string) {
              return async (args: any) => {
                calls.push({ model, method, args });
                return respond(model, method, args);
              };
            },
          },
        );
      },
    },
  );
  return client;
}

function withHelpers(client: any, calls: RecordedCall[]): FakePrisma {
  return {
    client,
    calls,
    callsOf: (model, method) => calls.filter((c) => c.model === model && (!method || c.method === method)),
    modelsTouched: () => Array.from(new Set(calls.map((c) => c.model))),
  };
}

// ─── Fake sem estado ─────────────────────────────────────────────────────────

export function createFakePrisma(overrides: Record<string, Responder> = {}): FakePrisma {
  const calls: RecordedCall[] = [];

  const respond = (model: string, method: string, args: any) => {
    const override = overrides[`${model}.${method}`];
    if (override) return override(args);
    switch (method) {
      case 'upsert':
        return { id: nextId(model), ...(args?.create ?? {}) };
      case 'create':
        return { id: nextId(model), ...(args?.data ?? {}) };
      case 'createMany':
        return { count: Array.isArray(args?.data) ? args.data.length : 0 };
      case 'findUnique':
        // produtos e usuário demo "existem" para exercitar BOM/roteiro/estoque
        return model === 'product' || model === 'user' ? { id: nextId(model) } : null;
      case 'findFirst':
        return null; // nada existe ainda → blocos condicionais criam
      case 'findMany':
        // perfis system "existem" (como se o seed estrutural já tivesse rodado)
        if (model === 'role' && Array.isArray(args?.where?.code?.in)) {
          return args.where.code.in.map((code: string) => ({ id: `role-${code}`, code }));
        }
        return [];
      case 'updateMany':
      case 'deleteMany':
        return { count: 0 };
      case 'delete':
      case 'update':
        return { id: nextId(model) };
      default:
        return null;
    }
  };

  return withHelpers(buildClient(calls, respond), calls);
}

// ─── Fake com store em memória ───────────────────────────────────────────────

function isPlainObject(v: any): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

function matches(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries<any>(where)) {
    if (key === 'AND') return (cond as any[]).every((w) => matches(row, w));
    if (key === 'OR') return (cond as any[]).some((w) => matches(row, w));
    if (cond === null) {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (isPlainObject(cond)) {
      const ops = Object.keys(cond);
      const isOperator = ops.some((o) => ['in', 'notIn', 'not', 'equals', 'contains', 'gte', 'lte', 'gt', 'lt'].includes(o));
      if (isOperator) {
        if ('in' in cond && !cond.in.includes(row[key])) return false;
        if ('notIn' in cond && cond.notIn.includes(row[key])) return false;
        if ('equals' in cond && row[key] !== cond.equals) return false;
        if ('not' in cond && row[key] === cond.not) return false;
        continue;
      }
      // chave composta Prisma: `a_b_c: { a, b, c }`
      if (!(key in row) && key.includes('_')) {
        if (!matches(row, cond)) return false;
        continue;
      }
      if (JSON.stringify(row[key]) !== JSON.stringify(cond)) return false;
      continue;
    }
    if (row[key] !== cond) return false;
  }
  return true;
}

export function createMemoryPrisma(): MemoryPrisma {
  const calls: RecordedCall[] = [];
  const store: Record<string, any[]> = {};
  const rows = (model: string) => (store[model] ??= []);

  const insert = (model: string, data: any) => {
    const row = { id: data?.id ?? nextId(model), ...data };
    rows(model).push(row);
    return row;
  };

  const respond = (model: string, method: string, args: any) => {
    const list = rows(model);
    switch (method) {
      case 'findMany':
        return list.filter((r) => matches(r, args?.where));
      case 'findFirst':
      case 'findUnique':
        return list.find((r) => matches(r, args?.where)) ?? null;
      case 'create':
        return insert(model, args.data);
      case 'createMany': {
        const data = Array.isArray(args?.data) ? args.data : [];
        data.forEach((d: any) => insert(model, d));
        return { count: data.length };
      }
      case 'upsert': {
        const existing = list.find((r) => matches(r, args.where));
        if (existing) {
          Object.assign(existing, args.update ?? {});
          return existing;
        }
        return insert(model, args.create);
      }
      case 'update': {
        const existing = list.find((r) => matches(r, args.where));
        if (!existing) throw new Error(`memory prisma: ${model}.update sem registro`);
        Object.assign(existing, args.data ?? {});
        return existing;
      }
      case 'updateMany': {
        const hit = list.filter((r) => matches(r, args?.where));
        hit.forEach((r) => Object.assign(r, args.data ?? {}));
        return { count: hit.length };
      }
      case 'delete':
      case 'deleteMany': {
        const before = list.length;
        store[model] = list.filter((r) => !matches(r, args?.where));
        return { count: before - store[model].length };
      }
      case 'count':
        return list.filter((r) => matches(r, args?.where)).length;
      default:
        throw new Error(`memory prisma: método não suportado ${model}.${method}`);
    }
  };

  return { ...withHelpers(buildClient(calls, respond), calls), store, rows };
}

/** Modelos que um seed ESTRUTURAL jamais pode tocar. */
export const DEMO_ONLY_MODELS = [
  'company',
  'user',
  'product',
  'supplier',
  'customer',
  'bomVersion',
  'routingStep',
  'warehouse',
  'stockBalance',
  'stockMovement',
  'taxRule',
  'financialCategory',
  'costCenter',
];

/** Modelos do catálogo IAM/estrutural que o seed DEMO jamais pode ESCREVER. */
export const STRUCTURAL_CATALOG_MODELS = ['tributaryClassification', 'permission', 'role', 'rolePermission', 'plan'];

/** Extrai todos os e-mails presentes em um payload serializado. */
export function extractEmails(payload: string): string[] {
  return Array.from(new Set(payload.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [])).map((e) => e.toLowerCase());
}
