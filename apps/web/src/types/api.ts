/**
 * Tipos globais dos recursos da API Avequi.
 *
 * Convenções:
 * - Campos Decimal do Prisma chegam como `string` no JSON.
 * - Campos DateTime chegam como `string` ISO.
 * - Endpoints de lista retornam array puro (sem envelope de paginação).
 */

// ─── Enums (espelham o schema Prisma) ─────────────────────────────────────────
export type CompanyType = 'MATRIZ' | 'FILIAL';

export type TaxRegime = 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL';

export type UserRole =
  | 'SUPER_ADMIN'
  | 'DIRECTOR'
  | 'MANAGER'
  | 'COMMERCIAL'
  | 'PRODUCTION'
  | 'QUALITY'
  | 'WAREHOUSE'
  | 'FINANCIAL'
  | 'STORE'
  | 'READER';

export type ProductType =
  | 'RAW_MATERIAL'
  | 'SEMI_FINISHED'
  | 'FINISHED_GOOD'
  | 'CONSUMABLE'
  | 'SERVICE'
  | 'COMPONENT';

export type UnitOfMeasure = 'UN' | 'KG' | 'G' | 'M' | 'M2' | 'M3' | 'L' | 'PC' | 'CX' | 'PR';

export type CustomerType = 'INDIVIDUAL' | 'COMPANY';

export type FinancialEntryType = 'RECEIVABLE' | 'PAYABLE';
export type FinancialEntryStatus =
  | 'OPEN'
  | 'OVERDUE'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED';
export type PaymentMethod = 'BOLETO' | 'PIX' | 'TED' | 'DINHEIRO' | 'CARTAO' | 'CHEQUE';
export type EntrySource = 'AUTO_SALES' | 'AUTO_PURCHASE' | 'MANUAL';
export type FinancialCategoryType = 'REVENUE' | 'EXPENSE' | 'TRANSFER' | 'GROUP';
export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

// ─── Base ─────────────────────────────────────────────────────────────────────
export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt?: string;
}

// ─── Recursos ─────────────────────────────────────────────────────────────────
export interface Company extends BaseEntity {
  name: string;
  cnpj: string;
  type: CompanyType;
  parentId?: string | null;
  // Dados fiscais (#161)
  razaoSocial?: string | null;
  ie?: string | null;
  im?: string | null;
  crt?: number | null;
  taxRegime?: TaxRegime | null;
  suframa?: string | null;
  cnae?: string | null;
  // Endereço
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  ibgeCode?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface User extends BaseEntity {
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  companyId: string;
  company?: Pick<Company, 'id' | 'name'>;
}

export interface Product extends BaseEntity {
  companyId: string;
  sku: string;
  name: string;
  description?: string | null;
  type: ProductType;
  unit: UnitOfMeasure;
  ncm?: string | null;
  costPrice?: string | null;
  salePrice?: string | null;
  avgCost?: string | null;
  minStock: string;
  isActive: boolean;
}

export interface Supplier extends BaseEntity {
  companyId: string;
  name: string;
  cnpj?: string | null;
  email?: string | null;
  phone?: string | null;
  leadTimeDays: number;
  isActive: boolean;
}

export interface Customer extends BaseEntity {
  companyId: string;
  type: CustomerType;
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  isActive: boolean;
}

export interface Warehouse extends BaseEntity {
  companyId: string;
  name: string;
  code: string;
  description?: string | null;
  isActive: boolean;
  wmsEnabled: boolean;
}

export interface FinancialEntry extends BaseEntity {
  companyId: string;
  type: FinancialEntryType;
  status: FinancialEntryStatus;
  amount: string;
  dueDate: string;
  description?: string | null;
  source: EntrySource;
  paidAt?: string | null;
  paidAmount?: string | null;
  paymentNote?: string | null;
  salesOrderId?: string | null;
  purchaseOrderId?: string | null;
  // Relações incluídas pelo GET /finance
  salesOrder?: { id: string; customer?: Pick<Customer, 'id' | 'name'> | null } | null;
  purchaseOrder?: {
    id: string;
    status?: PurchaseOrderStatus;
    approvedAt?: string | null;
    supplier?: Pick<Supplier, 'id' | 'name'> | null;
  } | null;
}

export interface FinancialCategory extends BaseEntity {
  companyId: string;
  name: string;
  code?: string | null;
  type: FinancialCategoryType;
  parentId?: string | null;
  dreCode?: string | null;
  isActive: boolean;
  children?: FinancialCategory[];
}

export type ScheduledPaymentStatus = 'PENDING' | 'DONE' | 'CANCELLED' | 'FAILED';

/**
 * Agendamento de pagamento (#98). O backend ainda NÃO expõe esse recurso
 * (issue #241) — tipo definido para a tela funcionar como preview e ligar
 * automaticamente quando os endpoints /banking/schedule existirem.
 */
export interface ScheduledPayment {
  id: string;
  financialEntryId: string;
  bankAccountId: string;
  scheduledDate: string;
  amount: string;
  status: ScheduledPaymentStatus;
  financialEntry?: {
    id: string;
    description?: string | null;
    purchaseOrder?: { supplier?: { name: string } | null } | null;
  } | null;
  bankAccount?: { id: string; name: string } | null;
}

export type BoletoStatus = 'PENDING' | 'REGISTERED' | 'PAID' | 'CANCELLED' | 'OVERDUE' | 'WRITTEN_OFF';

export interface Boleto {
  id: string;
  nossoNumero: string;
  seuNumero?: string | null;
  amount: string;
  dueDate: string;
  status: BoletoStatus;
  payerName: string;
  payerDocument: string;
  bankAccount?: { id: string; name: string } | null;
  createdAt: string;
}

export interface PixCharge {
  id: string;
  txId: string;
  amount: string;
  pixKey: string;
  qrCode: string;
  status: string;
  description?: string | null;
  createdAt: string;
}

export interface ReconciliationItem {
  id: string;
  companyId: string;
  bankAccountId: string;
  date: string;
  description: string;
  amount: string;
  type: string;
  matched: boolean;
  matchedToId?: string | null;
  matchedToType?: string | null;
  bankAccount?: { id: string; name: string } | null;
  createdAt: string;
}

export interface BankAccount extends BaseEntity {
  companyId: string;
  name: string;
  bank?: string | null;
  agency?: string | null;
  account?: string | null;
  balance: string;
  active: boolean;
}

export interface CostCenter extends BaseEntity {
  companyId: string;
  name: string;
  code?: string | null;
  parentId?: string | null;
  isActive: boolean;
  children?: CostCenter[];
}

// ─── Inputs (create/update) ───────────────────────────────────────────────────
export type CreateProductInput = Omit<
  Product,
  keyof BaseEntity | 'companyId'
> & { companyId: string };

export type CreateSupplierInput = Omit<Supplier, keyof BaseEntity | 'companyId'> & {
  companyId: string;
};

export type CreateCustomerInput = Omit<Customer, keyof BaseEntity | 'companyId'> & {
  companyId: string;
};

export type CreateWarehouseInput = Omit<Warehouse, keyof BaseEntity | 'companyId'> & {
  companyId: string;
};

// ─── Erro padrão da API ───────────────────────────────────────────────────────
export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}
