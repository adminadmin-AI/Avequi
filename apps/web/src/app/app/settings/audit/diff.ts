/**
 * Trilha de auditoria: transforma o diff bruto do AuditLogV2 (oldValue /
 * newValue, JSON) em algo que uma pessoa lê — pedido do Rafael (11/08/2026):
 * "quando eu expando aparece um código; tem que mudar a visualização".
 *
 * Funções puras (testadas em diff.spec.ts); a página só renderiza.
 */

export type TipoDeMudanca = 'criado' | 'removido' | 'alterado' | 'vazio';

/**
 * Nomes de campo em português (pedido do Rafael, 11/08: "dá pra deixar em
 * português e dando pra entender sobre o que se trata?"). Campo fora do
 * dicionário aparece como veio — melhor técnico que errado.
 */
const CAMPOS_PT: Record<string, string> = {
  items: 'itens',
  quantity: 'quantidade',
  productId: 'produto',
  supplierId: 'fornecedor',
  customerId: 'cliente',
  userId: 'usuário',
  workCenterId: 'centro de trabalho',
  categoryId: 'categoria',
  costCenterId: 'centro de custo',
  companyId: 'empresa',
  warehouseId: 'depósito',
  name: 'nome',
  description: 'descrição',
  code: 'código',
  sku: 'SKU',
  email: 'e-mail',
  role: 'papel',
  status: 'status',
  amount: 'valor',
  price: 'preço',
  salePrice: 'preço de venda',
  costPrice: 'preço de custo',
  dueDate: 'vencimento',
  issueDate: 'emissão',
  paidAt: 'pago em',
  createdAt: 'criado em',
  updatedAt: 'atualizado em',
  isActive: 'ativo',
  unit: 'unidade',
  notes: 'observações',
  pixKey: 'chave PIX',
  cnpj: 'CNPJ',
  phone: 'telefone',
};

export function nomeDoCampo(campo: string): string {
  return CAMPOS_PT[campo] ?? campo;
}

/**
 * Resolve um ID para um rótulo humano (ex.: productId -> "MOD-CAR-006 ·
 * Carga 2,50m"). A página injeta o resolvedor com os cadastros que já tem
 * em cache; sem resolução, o ID aparece encurtado (8 primeiros caracteres).
 */
export type ResolvedorDeRef = (campo: string, id: string) => string | null;

const CAMPOS_DE_REFERENCIA = new Set(Object.keys(CAMPOS_PT).filter((k) => k.endsWith('Id')));

function encurtarId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export interface CampoDoDiff {
  campo: string;
  antes: string | null;
  depois: string | null;
}

export interface DiffLegivel {
  tipo: TipoDeMudanca;
  campos: CampoDoDiff[];
}

function ehObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Valor de UM campo, em texto curto e humano.
 * Estruturas aninhadas viram resumo compacto (sem chaves/aspas de JSON),
 * porque o nível de cima já dá o contexto.
 */
export function valorLegivel(v: unknown, resolver?: ResolvedorDeRef, campo?: string): string {
  if (campo && CAMPOS_DE_REFERENCIA.has(campo) && typeof v === 'string' && v) {
    return resolver?.(campo, v) ?? encurtarId(v);
  }
  if (v === null || v === undefined || v === '') return '(vazio)';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    // Datas ISO ficam mais curtas: 2026-08-11T14:03:22.000Z -> 11/08/2026 14:03
    const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]} ${iso[4]}:${iso[5]}`;
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '(lista vazia)';
    return v.map((item) => valorLegivel(item, resolver)).join('; ');
  }
  if (ehObjetoPlano(v)) {
    return Object.entries(v)
      .map(([k, val]) => `${nomeDoCampo(k)}: ${valorLegivel(val, resolver, k)}`)
      .join(', ');
  }
  return String(v);
}

/**
 * Compara oldValue/newValue campo a campo (nível de cima) e devolve só o que
 * interessa: em criação/remoção, todos os campos com valor; em alteração,
 * SOMENTE os campos que mudaram.
 */
export function diffLegivel(oldValue: unknown, newValue: unknown, resolver?: ResolvedorDeRef): DiffLegivel {
  const antes = ehObjetoPlano(oldValue) ? oldValue : null;
  const depois = ehObjetoPlano(newValue) ? newValue : null;

  if (!antes && !depois) {
    // Diff não estruturado (escalar/array na raiz) — mostra como campo único.
    if (oldValue != null || newValue != null) {
      return {
        tipo: oldValue == null ? 'criado' : newValue == null ? 'removido' : 'alterado',
        campos: [
          {
            campo: 'valor',
            antes: oldValue == null ? null : valorLegivel(oldValue, resolver),
            depois: newValue == null ? null : valorLegivel(newValue, resolver),
          },
        ],
      };
    }
    return { tipo: 'vazio', campos: [] };
  }

  if (!antes && depois) {
    return {
      tipo: 'criado',
      campos: Object.entries(depois).map(([campo, v]) => ({
        campo: nomeDoCampo(campo),
        antes: null,
        depois: valorLegivel(v, resolver, campo),
      })),
    };
  }

  if (antes && !depois) {
    return {
      tipo: 'removido',
      campos: Object.entries(antes).map(([campo, v]) => ({
        campo: nomeDoCampo(campo),
        antes: valorLegivel(v, resolver, campo),
        depois: null,
      })),
    };
  }

  const chaves = [...new Set([...Object.keys(antes!), ...Object.keys(depois!)])].sort();
  const campos: CampoDoDiff[] = [];
  for (const campo of chaves) {
    const a = antes![campo];
    const d = depois![campo];
    if (JSON.stringify(a) === JSON.stringify(d)) continue; // não mudou: não polui
    campos.push({
      campo: nomeDoCampo(campo),
      antes: valorLegivel(a, resolver, campo),
      depois: valorLegivel(d, resolver, campo),
    });
  }
  return { tipo: 'alterado', campos };
}

export const TITULO_POR_TIPO: Record<TipoDeMudanca, string> = {
  criado: 'Registro criado com os dados:',
  removido: 'Registro removido. Dados que existiam:',
  alterado: 'O que mudou:',
  vazio: 'Sem detalhes registrados.',
};

/** Ações do enum AuditAction em português, para a tabela e o filtro. */
export const ACOES_PT: Record<string, string> = {
  CREATE: 'Criação',
  UPDATE: 'Alteração',
  DELETE: 'Exclusão',
  APPROVE: 'Aprovação',
  REJECT: 'Rejeição',
  CANCEL: 'Cancelamento',
  FINALIZE: 'Finalização',
  REOPEN: 'Reabertura',
  EXPORT: 'Exportação',
  IMPORT: 'Importação',
  PRINT: 'Impressão',
  EXECUTE: 'Execução',
  PROCESS: 'Processamento',
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  OTHER: 'Outra',
};

export function nomeDaAcao(acao: string): string {
  return ACOES_PT[acao] ?? acao;
}

/** Entidades mais comuns em português; fora do dicionário, como veio. */
const ENTIDADES_PT: Record<string, string> = {
  Product: 'Produto',
  Supplier: 'Fornecedor',
  Customer: 'Cliente',
  User: 'Usuário',
  UserSession: 'Sessão de usuário',
  FinancialEntry: 'Lançamento financeiro',
  SalesOrder: 'Pedido de venda',
  PurchaseOrder: 'Pedido de compra',
  ProductionOrder: 'Ordem de produção',
  WorkCenter: 'Centro de trabalho',
  StockMovement: 'Movimento de estoque',
  production: 'Produção (despacho)',
  finance: 'Financeiro',
  crm: 'CRM',
};

export function nomeDaEntidade(entidade: string): string {
  return ENTIDADES_PT[entidade] ?? entidade;
}
