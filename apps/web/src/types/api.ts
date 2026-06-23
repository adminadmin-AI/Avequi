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
