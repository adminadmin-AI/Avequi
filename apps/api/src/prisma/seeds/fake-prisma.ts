/**
 * PrismaClient falso para os testes dos seeds: grava toda chamada
 * `model.method(args)` e devolve respostas neutras, sem tocar em banco.
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

let seq = 0;

export function createFakePrisma(): FakePrisma {
  const calls: RecordedCall[] = [];

  const respond = (model: string, method: string, args: any) => {
    seq += 1;
    switch (method) {
      case 'upsert':
        return { id: `${model}-${seq}`, ...(args?.create ?? {}) };
      case 'create':
        return { id: `${model}-${seq}`, ...(args?.data ?? {}) };
      case 'createMany':
        return { count: Array.isArray(args?.data) ? args.data.length : 0 };
      case 'findUnique':
        // produtos e usuário demo "existem" para exercitar BOM/roteiro/estoque
        return model === 'product' || model === 'user' ? { id: `${model}-${seq}` } : null;
      case 'findFirst':
        return null; // nada existe ainda → blocos condicionais criam
      case 'findMany':
        return [];
      case 'updateMany':
      case 'deleteMany':
        return { count: 0 };
      case 'delete':
      case 'update':
        return { id: `${model}-${seq}` };
      default:
        return null;
    }
  };

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

  return {
    client,
    calls,
    callsOf: (model, method) => calls.filter((c) => c.model === model && (!method || c.method === method)),
    modelsTouched: () => Array.from(new Set(calls.map((c) => c.model))),
  };
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
