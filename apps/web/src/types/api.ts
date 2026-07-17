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
export type SalesOrderStatus =
  | 'DRAFT'
  | 'CREDIT_HOLD'
  | 'RESERVED'
  | 'CONFIRMED'
  | 'AWAITING_PICKING'
  | 'AWAITING_CONFERENCE'
  | 'READY_TO_INVOICE'
  | 'INVOICED'
  | 'RETURNED'
  | 'CANCELLED';

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

export type FiscalStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'AUTHORIZED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'ERROR';
export type FiscalDocumentType = 'NFE' | 'NFCE';

// #758 — finalidade da nota (Reforma Tributária: notas de ajuste IBS/CBS além
// da devolução #754). O modelo NÃO ganhou um FiscalDocumentType novo — a
// distinção é por finalidade + vínculo com a NF-e original.
export type FiscalFinalidade =
  | 'NORMAL'
  | 'COMPLEMENTAR'
  | 'AJUSTE'
  | 'DEVOLUCAO'
  | 'NOTA_CREDITO'
  | 'NOTA_DEBITO';

// #758 — impostos IBS/CBS persistidos por item (base/alíquota/valor efetivos
// da NF-e original), usados pelo wizard de nota de ajuste.
export interface FiscalDocumentItemTax {
  id: string;
  cClassTrib?: string | null;
  cstCbs?: string | null;
  baseCbs?: string | null;
  aliquotaCbs?: string | null;
  valorCbs?: string | null;
  cstIbsUf?: string | null;
  baseIbsUf?: string | null;
  aliquotaIbsUf?: string | null;
  valorIbsUf?: string | null;
  cstIbsMun?: string | null;
  baseIbsMun?: string | null;
  aliquotaIbsMun?: string | null;
  valorIbsMun?: string | null;
}

export interface FiscalDocumentItem {
  id: string;
  productCode?: string | null;
  productName: string;
  ncm?: string | null;
  cfop?: string | null;
  unit?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  totalPrice?: string | null;
  taxes?: FiscalDocumentItemTax[];
}

// #758 — resumo da NF-e referenciada (findOne inclui referencedDocument)
export interface FiscalDocumentRef {
  id: string;
  number?: number | null;
  series?: number | null;
  type: FiscalDocumentType;
  finalidade: FiscalFinalidade;
  status: FiscalStatus;
  chave?: string | null;
}

// #758 — resumo dos documentos que referenciam este (devolução/débito/crédito)
export interface FiscalDocumentReferencing {
  id: string;
  number?: number | null;
  series?: number | null;
  type: FiscalDocumentType;
  finalidade: FiscalFinalidade;
  status: FiscalStatus;
  tipoNotaDebito?: string | null;
  tipoNotaCredito?: string | null;
  createdAt: string;
}

export interface FiscalDocument extends BaseEntity {
  companyId: string;
  salesOrderId?: string | null;
  salesOrder?: { id: string; customer?: Pick<Customer, 'id' | 'name'> | null } | null;
  type: FiscalDocumentType;
  status: FiscalStatus;
  // #754/#758 — finalidade + vínculo bidirecional com a NF-e original
  finalidade: FiscalFinalidade;
  referencedDocumentId?: string | null;
  referencedDocument?: FiscalDocumentRef | null;
  referencingDocuments?: FiscalDocumentReferencing[];
  tipoNotaDebito?: string | null; // tpNFDebito 01-08 (SINIEF 49/2025)
  tipoNotaCredito?: string | null; // tpNFCredito 01-06
  focusRef?: string | null;
  chave?: string | null;
  number?: number | null;
  series?: number | null;
  protocolNumber?: string | null;
  authorizedAt?: string | null;
  xml?: string | null;
  danfeUrl?: string | null; // caminho do DANFE na Focus (#482)
  xmlUrl?: string | null;
  rejectionCode?: string | null;
  rejectionReason?: string | null;
  cancelledAt?: string | null;
  cancellationJustification?: string | null;
  items?: FiscalDocumentItem[];
}

export type ProductionOrderStatus =
  | 'DRAFT'
  | 'RELEASED'
  | 'IN_PROGRESS'
  | 'PENDING_INSPECTION'
  | 'DONE'
  | 'CANCELLED';

export interface ProductionOrder extends BaseEntity {
  companyId: string;
  productId: string;
  product?: Pick<Product, 'id' | 'sku' | 'name' | 'unit'> | null;
  warehouseId: string;
  warehouse?: Pick<Warehouse, 'id' | 'name' | 'code'> | null;
  plannedQty: string;
  producedQty: string;
  status: ProductionOrderStatus;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
}

// ─── Manutenção (FE-F9 / módulo maintenance) ──────────────────────────────────
export type EquipmentStatus = 'ACTIVE' | 'INACTIVE' | 'UNDER_MAINTENANCE' | 'SCRAPPED';

export type MaintenanceType = 'PREVENTIVE' | 'CORRECTIVE' | 'CALIBRATION' | 'INSPECTION';

export type MaintenanceOrderStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface Equipment extends BaseEntity {
  companyId: string;
  code: string;
  name: string;
  description?: string | null;
  location?: string | null;
  status: EquipmentStatus;
  acquisitionDate?: string | null;
  nextMaintenanceAt?: string | null;
  maintenanceIntervalDays: number;
  _count?: { maintenanceOrders: number };
}

export interface MaintenanceOrder extends BaseEntity {
  companyId: string;
  equipmentId: string;
  equipment?: Pick<Equipment, 'id' | 'code' | 'name' | 'location'> | null;
  type: MaintenanceType;
  status: MaintenanceOrderStatus;
  title: string;
  description?: string | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  technicianId?: string | null;
  technician?: Pick<User, 'id' | 'name' | 'email'> | null;
  resolution?: string | null;
  cost?: string | null;
  createdById?: string | null;
}

export interface WorkCenter extends BaseEntity {
  companyId: string;
  code: string;
  name: string;
  description?: string | null;
  capacityHoursPerDay: string;
  costPerHour: string;
  operatorsCount: number;
  efficiencyPct: string;
  isActive: boolean;
}

export type TransferStatus = 'DRAFT' | 'DISPATCHED' | 'RECEIVED' | 'CANCELLED';

export interface StoreTransferItem {
  id: string;
  productId: string;
  product?: Pick<Product, 'id' | 'sku' | 'name'> | null;
  quantity: string;
}

export interface StoreTransfer extends BaseEntity {
  companyId: string;
  fromWarehouseId: string;
  fromWarehouse?: Pick<Warehouse, 'id' | 'name' | 'code'> | null;
  toWarehouseId: string;
  toWarehouse?: Pick<Warehouse, 'id' | 'name' | 'code'> | null;
  status: TransferStatus;
  notes?: string | null;
  items?: StoreTransferItem[];
}

export type MovementType =
  | 'ENTRY'
  | 'EXIT'
  | 'ADJUSTMENT'
  | 'REVERSAL'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN';

export interface StockBalance {
  id: string;
  warehouseId: string;
  warehouse?: Pick<Warehouse, 'id' | 'name' | 'code'> | null;
  productId: string;
  product?: Product | null;
  available: string;
  reserved: string;
  inTransit: string;
  pendingPutaway: string;
}

export interface StockMovement {
  id: string;
  warehouseId: string;
  warehouse?: Pick<Warehouse, 'id' | 'name' | 'code'> | null;
  productId: string;
  product?: Pick<Product, 'id' | 'sku' | 'name'> | null;
  type: MovementType;
  quantity: string;
  reason: string;
  reference?: string | null;
  reversedById?: string | null;
  userId?: string | null;
  user?: { id: string; name: string } | null;
  createdAt: string;
}

export interface POItem {
  id: string;
  productId: string;
  product?: Pick<Product, 'id' | 'sku' | 'name'> | null;
  quantity: string;
  unitCost: string;
  unit: UnitOfMeasure;
  receivedQuantity?: string;
}

export interface PurchaseOrder extends BaseEntity {
  companyId: string;
  supplierId: string;
  supplier?: Pick<Supplier, 'id' | 'name'> | null;
  status: PurchaseOrderStatus;
  expectedAt?: string | null;
  notes?: string | null;
  approvedAt?: string | null;
  items?: POItem[];
}

// ─── Base ─────────────────────────────────────────────────────────────────────
export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt?: string;
}

// ─── Suporte (épico #764) ───────────────────────────────────────────────────────
export type SupportIncidentStatus =
  | 'NEW'
  | 'TRIAGING'
  | 'TRIAGED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED';
export type SupportIncidentSeverity = 'P0' | 'P1' | 'P2' | 'P3';

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
  origem?: string | null; // 0-8 — orig da NF-e (#480)
  ean?: string | null; // GTIN (#484)
  cest?: string | null;
  pesoLiquido?: string | null; // kg (#484)
  pesoBruto?: string | null;
  unidadeTributavel?: string | null;
  fatorConversaoTributavel?: string | null;
  costPrice?: string | null;
  salePrice?: string | null;
  avgCost?: string | null;
  minStock: string;
  isActive: boolean;
  tracksSerial?: boolean; // rastreável por chassi — balcão exige scan (#595)
}

export interface Supplier extends BaseEntity {
  companyId: string;
  name: string;
  razaoSocial?: string | null;
  cnpj?: string | null;
  ie?: string | null;
  taxRegime?: TaxRegime | null; // crédito IBS/CBS 2027 (#478)
  email?: string | null;
  fiscalEmail?: string | null;
  phone?: string | null;
  phone2?: string | null;
  contactName?: string | null;
  address?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  ibgeCode?: string | null;
  defaultPaymentTerms?: string | null;
  bankName?: string | null;
  bankAgency?: string | null;
  bankAccount?: string | null;
  pixKey?: string | null;
  leadTimeDays: number;
  isActive: boolean;
}

export type IcmsIndicator = 'CONTRIBUINTE' | 'ISENTO' | 'NAO_CONTRIBUINTE';

export interface CustomerAddress {
  id: string;
  label: string;
  address: string;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city: string;
  state: string;
  zipCode?: string | null;
  ibgeCode?: string | null;
  isDefault: boolean;
}

export interface Customer extends BaseEntity {
  razaoSocial?: string | null;
  fiscalEmail?: string | null;
  phone2?: string | null;
  contactName?: string | null;
  ie?: string | null;
  indIeDest?: IcmsIndicator | null;
  isRuralProducer?: boolean;
  isSimplesNacional?: boolean;
  addresses?: CustomerAddress[];
  companyId: string;
  type: CustomerType;
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  ibgeCode?: string | null;
  isActive: boolean;
}

/** Transportadora — grupo transp da NF-e (#481) */
export interface Carrier extends BaseEntity {
  companyId: string;
  name: string;
  razaoSocial?: string | null;
  document?: string | null;
  ie?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  vehiclePlate?: string | null;
  vehiclePlateState?: string | null;
  rntc?: string | null;
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

export type QuotationStatus =
  | 'DRAFT'
  | 'SENT'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CONVERTED';

export interface QuotationItem {
  id: string;
  productId: string;
  product?: Pick<Product, 'id' | 'sku' | 'name'> | null;
  quantity: string;
  unitPrice: string;
  discount?: string | null;
}

export interface Quotation extends BaseEntity {
  companyId: string;
  customerId?: string | null;
  customer?: Pick<Customer, 'id' | 'name'> | null;
  warehouseId: string;
  status: QuotationStatus;
  validUntil?: string | null;
  notes?: string | null;
  discount?: string | null;
  rejectionReason?: string | null;
  salesOrderId?: string | null;
  items?: QuotationItem[];
}

export interface SaleItem {
  id: string;
  productId: string;
  product?: (Pick<Product, 'id' | 'sku' | 'name'> & { tracksSerial?: boolean }) | null;
  serialNumberId?: string | null; // chassi amarrado na separação (#490)
  serialNumber?: { id: string; serial: string; chassi?: string | null } | null;
  quantity: string;
  unitPrice: string;
  unit: UnitOfMeasure;
}

/** #584 — forma de pagamento do plano da venda (detPag é lista) */
export interface SalesPayment {
  id: string;
  method: string;
  amount: string;
  installments: number;
  acquirerId?: string | null;
  acquirer?: { id: string; name: string } | null;
  brand?: string | null;
  mdrRate?: string | null;
  mdrAmount?: string | null;
  settlementDays?: number | null;
  authStatus: 'PENDING' | 'AUTHORIZED' | 'DENIED';
  authCode?: string | null;
  nsu?: string | null;
  authorizedAt?: string | null;
}

export interface SalesOrder extends BaseEntity {
  companyId: string;
  customerId?: string | null;
  customer?: Pick<Customer, 'id' | 'name'> | null;
  warehouseId: string;
  warehouse?: Pick<Warehouse, 'id' | 'name' | 'code'> | null;
  status: SalesOrderStatus;
  channel?: string; // FACTORY | COUNTER — venda balcão (#595)
  paymentMethod?: string | null; // forma legada (detPag) — retrocompat #479
  notes?: string | null;
  confirmedAt?: string | null;
  invoicedAt?: string | null;
  items?: SaleItem[];
  payments?: SalesPayment[]; // plano de pagamento (#584)
  createdBy?: { id: string; name: string } | null;
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
 * Agendamento de pagamento (#98). Backend disponível desde o PR #296
 * (endpoints GET /banking/schedules, POST /banking/schedule,
 * DELETE /banking/schedule/:id). O shape abaixo reflete o include real
 * do FinanceService.findAllScheduledPayments.
 */
export interface ScheduledPayment {
  id: string;
  financialEntryId: string;
  bankAccountId: string;
  scheduledDate: string;
  amount: string;
  status: ScheduledPaymentStatus;
  note?: string | null;
  financialEntry?: {
    id: string;
    description?: string | null;
    amount?: string;
    dueDate?: string;
    type?: string;
    status?: string;
  } | null;
  bankAccount?: { id: string; name: string; bank?: string | null } | null;
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
  // Configuração de cobrança/integração (PATCH /banking/accounts/:id/configure)
  provider?: string | null;
  pixKey?: string | null;
  minCashBalance?: string | null;
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
// companyId NÃO é mais enviado no body: a API deriva a empresa do JWT.
export type CreateProductInput = Omit<Product, keyof BaseEntity | 'companyId'>;

export type CreateSupplierInput = Omit<Supplier, keyof BaseEntity | 'companyId'>;

export type CreateCustomerInput = Omit<Customer, keyof BaseEntity | 'companyId'>;

export type CreateWarehouseInput = Omit<Warehouse, keyof BaseEntity | 'companyId'>;

// ─── IAM v2 — perfis e permissões (#352) ──────────────────────────────────────

export interface IamPermission {
  id: string;
  code: string; // modulo.recurso.acao
  name: string;
  description?: string | null;
  module: string;
  resource: string;
  action: string;
}

/** Catálogo agrupado (GET /iam/permissions) — árvore módulo → recurso. */
export interface IamPermissionCatalogModule {
  module: string;
  resources: Array<{
    resource: string;
    permissions: IamPermission[];
  }>;
}

export interface IamRole {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  isActive: boolean;
  requireMfa: boolean;
  companyId?: string | null;
  parentId?: string | null;
  parent?: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  _count?: { userAssignments: number; rolePermissions: number };
}

/** GET /iam/roles/:id/permissions */
export interface IamRolePermissions {
  roleId: string;
  code: string;
  name: string;
  isSystem: boolean;
  /** codes concedidos DIRETAMENTE ao perfil */
  codes: string[];
  /** denies em nível de perfil (raros; vencem grants de perfil) */
  deniedCodes: string[];
  /** codes herdados via perfil pai (somente leitura na UI) */
  inheritedCodes: string[];
}

/** GET /iam/users/:userId/roles */
export interface IamUserRoleAssignment {
  id: string;
  roleId: string;
  role: { id: string; code: string; name: string; isSystem: boolean; isActive: boolean };
  branchId?: string | null;
  branch?: { id: string; code: string; name: string } | null;
  expiresAt?: string | null;
  grantedBy: string;
  createdAt: string;
}

/** GET /iam/users/:userId/permissions (exceções individuais) */
export interface IamUserPermission {
  id: string;
  granted: boolean;
  expiresAt?: string | null;
  reason?: string | null;
  grantedBy: string;
  createdAt: string;
  permission: Pick<IamPermission, 'id' | 'code' | 'name' | 'module' | 'resource' | 'action'>;
}

export interface CreateIamRoleInput {
  name: string;
  code?: string;
  description?: string;
  copyFromRoleId?: string;
}

export interface UpdateIamRoleInput {
  name?: string;
  description?: string;
  isActive?: boolean;
}

export interface AssignIamRoleInput {
  roleId: string;
  branchId?: string;
  expiresAt?: string;
}

/** GET /auth/me/permissions (#351) — permissões efetivas do usuário logado. */
export interface MyEffectivePermissions {
  /** Codes dos perfis DIRETAMENTE atribuídos (no fallback, o perfil-espelho). */
  roles: string[];
  /** Codes de permissão efetivos (herança + exceções já aplicadas). */
  permissions: string[];
  /** true = derivado do enum `User.role` legado (usuário ainda não migrado). */
  legacyFallback: boolean;
  /** Timestamp ISO da resolução no servidor. */
  resolvedAt: string;
}

export interface GrantIamPermissionInput {
  permissionCode: string;
  granted?: boolean;
  expiresAt?: string;
  reason?: string;
}

// ─── IAM v2 — estrutura organizacional (#347 F5.2, fase 1) ────────────────────

/** GET /iam/branches */
export interface IamBranch {
  id: string;
  code: string;
  name: string;
  cnpj?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { userRoleAssignments: number };
}

/** GET /iam/departments */
export interface IamDepartment {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  parentId?: string | null;
  parent?: { id: string; code: string; name: string } | null;
  managerId?: string | null;
  manager?: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  _count?: { teams: number; users: number; children: number };
}

/** GET /iam/teams */
export interface IamTeam {
  id: string;
  name: string;
  isActive: boolean;
  departmentId: string;
  department?: { id: string; code: string; name: string } | null;
  leaderId?: string | null;
  leader?: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  _count?: { members: number };
}

/** GET /iam/users/:userId/departments */
export interface IamUserDepartment {
  id: string;
  isPrimary: boolean;
  createdAt: string;
  department: { id: string; code: string; name: string; isActive: boolean };
}

/** GET /iam/users/:userId/teams */
export interface IamUserTeam {
  id: string;
  createdAt: string;
  team: {
    id: string;
    name: string;
    isActive: boolean;
    department: { id: string; code: string; name: string };
  };
}

export interface CreateIamBranchInput {
  name: string;
  code: string;
  cnpj?: string;
}

export interface UpdateIamBranchInput {
  name?: string;
  cnpj?: string;
  isActive?: boolean;
}

export interface CreateIamDepartmentInput {
  name: string;
  code: string;
  parentId?: string;
  managerId?: string;
}

export interface UpdateIamDepartmentInput {
  name?: string;
  parentId?: string | null;
  managerId?: string | null;
  isActive?: boolean;
}

export interface CreateIamTeamInput {
  name: string;
  departmentId: string;
  leaderId?: string;
}

export interface UpdateIamTeamInput {
  name?: string;
  departmentId?: string;
  leaderId?: string | null;
  isActive?: boolean;
}

export interface AddIamUserDepartmentInput {
  departmentId: string;
  isPrimary?: boolean;
}

export interface AddIamUserTeamInput {
  teamId: string;
}

// ─── Erro padrão da API ───────────────────────────────────────────────────────
export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

// ─── Formação de Preço (#395) — espelha PricingSimulation do backend ───────────
export interface PricingBreakdownItem {
  componentId: string;
  sku: string;
  name: string;
  quantity: number;
  unitCost: number;
  subtotal: number;
}
export interface PricingSimulation {
  productId: string;
  sku: string;
  name: string;
  productType: ProductType | null;
  cost: {
    base: number;
    source: 'override' | 'avgCost' | 'costPrice';
    materialFromBom: number | null;
    conversion: number | null; // base − material (MOD + CIF implícito no avgCost)
    breakdown: PricingBreakdownItem[] | null;
  };
  taxes: {
    ruleId: string | null;
    totalPct: number;
    icmsPct: number;
    ipiPct: number;
    pisPct: number;
    cofinsPct: number;
    warning?: string;
  };
  marginPct: number;
  suggestedPrice: number;
  currentPrice: number | null;
  comparison: {
    delta: number | null; // sugerido − atual
    deltaPct: number | null;
    currentMarginPct: number | null; // margem líquida realizada no preço atual
  };
}

// ─── Custeio por absorção (#396) — espelha CifRate/ProductAbsorptionCost ───────
export interface CifRate {
  ratePerHour: number;
  monthlyCif: number;
  monthlyProductiveHours: number;
  centers: number;
}
export interface CostLaborStep {
  step: string;
  workCenter: string | null;
  hours: number;
  costPerHour: number;
  cost: number;
}
export interface ProductAbsorptionCost {
  productId: string;
  sku: string;
  name: string;
  material: { total: number; breakdown: PricingBreakdownItem[] };
  labor: { total: number; hours: number; breakdown: CostLaborStep[] };
  cif: { ratePerHour: number; hours: number; total: number };
  totalWithoutCif: number; // material + MOD (custeio direto)
  totalWithCif: number; // + CIF rateado (absorção)
  cifImpactPct: number | null;
}

// ─── Forecast financeiro (#397) — espelha FinancialForecast do backend ─────────
export interface QuarterForecast {
  quarter: string; // ex.: "2026-Q3"
  months: string[];
  revenue: number; // demanda × preço médio
  expenses: number; // tendência linear
  result: number;
  budgeted: number | null; // Budget (soma dos meses)
  realized: { revenue: number; expenses: number; result: number; partial: boolean } | null;
}
export interface FinancialForecast {
  quarters: QuarterForecast[];
  assumptions: {
    expenseTrend: { slope: number; intercept: number; monthsBase: number };
    priceSource: string;
    generatedAt: string;
  };
}

// ─── Budget dirigido por drivers (#398) ────────────────────────────────────────
export interface BudgetPlanRow {
  id: string;
  year: number;
  name: string;
  variableExpensePct: string | number; // Prisma Decimal → string no JSON
  fixedExpenseMonthly: string | number;
  capex: string | number;
  createdAt: string;
  updatedAt: string;
}
export interface BudgetProjectionDriver {
  id?: string;
  label: string;
  productId: string | null;
  volume: number;
  avgPrice: number;
  unitCost: number;
  revenue: number;
  cpv: number;
  grossProfit: number;
  mixPct: number;
}
export interface BudgetProjection {
  planId: string;
  year: number;
  name: string;
  drivers: BudgetProjectionDriver[];
  revenue: number;
  cpv: number;
  grossProfit: number;
  variableExpenses: number;
  fixedExpenses: number;
  operatingResult: number;
  capex: number;
  resultAfterCapex: number;
  assumptions: { variableExpensePct: number; fixedExpenseMonthly: number; capex: number };
}
export interface BudgetSensitivity {
  base: { revenue: number; operatingResult: number };
  scenarios: Array<{
    scenario: string;
    revenue: number;
    operatingResult: number;
    revenueDelta: number;
    operatingResultDelta: number;
  }>;
}
export interface BudgetVsRealized {
  year: number;
  budgetedRevenue: number;
  realizedRevenue: number;
  revenueVariance: number;
  drivers: Array<{
    label: string;
    productId: string | null;
    budgetedRevenue: number;
    realizedRevenue: number | null;
    revenueVariance: number | null;
    budgetedVolume: number;
    realizedVolume: number | null;
    volumeVariance: number | null;
  }>;
}

// ─── Análise de investimentos (#399) — VPL/TIR/payback ─────────────────────────
export type InvestmentStatus = 'DRAFT' | 'APPROVED' | 'REJECTED';
export interface InvestmentCashflow {
  id: string;
  period: number; // 0 = aporte inicial
  amount: string | number; // Decimal → string no JSON
  label: string | null;
}
export interface InvestmentAnalysis {
  discountRatePct: number;
  npv: number;
  irrPct: number | null;
  paybackSimple: number | null; // períodos
  paybackDiscounted: number | null;
  series: Array<{
    period: number;
    flow: number;
    cumulative: number;
    discountedFlow: number;
    discountedCumulative: number;
  }>;
}
export interface InvestmentProject {
  id: string;
  name: string;
  description: string | null;
  discountRatePct: string | number;
  status: InvestmentStatus;
  approvedById: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  cashflows: InvestmentCashflow[];
  analysis: InvestmentAnalysis;
}
export interface InvestmentListItem {
  id: string;
  name: string;
  description: string | null;
  discountRatePct: string | number;
  status: InvestmentStatus;
  approvedAt: string | null;
  createdAt: string;
}
export interface InvestmentComparison {
  id: string;
  name: string;
  status: InvestmentStatus;
  npv: number;
  irrPct: number | null;
  paybackSimple: number | null;
  paybackDiscounted: number | null;
}

// ─── Expedição pós-NF-e (#496 · #364/#365) ─────────────────────────────────────
export type DeliveryStatus = 'AWAITING_BIN' | 'AWAITING_PICKUP' | 'IN_TRANSIT' | 'DELIVERED' | 'RETURNED';
export interface Delivery {
  id: string;
  companyId: string;
  salesOrderId: string;
  fiscalDocumentId: string | null;
  status: DeliveryStatus;
  scheduledDate: string | null;
  deliveredAt: string | null;
  transporterName: string | null;
  transporterCnpj: string | null;
  vehiclePlate: string | null;
  receivedBy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VehicleDocumentType = 'CAT' | 'CCT' | 'TECHNICAL_PROJECT';
export type VehicleDocumentStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export type DocumentDeliveredTo = 'RESELLER' | 'END_CUSTOMER';
export interface VehicleDocumentDelivery {
  id: string;
  vehicleDocumentId: string;
  salesOrderId: string;
  serialNumberId: string | null;
  deliveredTo: DocumentDeliveredTo;
  deliveredAt: string | null;
  deliveredBy: string | null;
  createdAt: string;
  vehicleDocument?: VehicleDocument;
}
export interface VehicleDocument {
  id: string;
  companyId: string;
  productId: string;
  type: VehicleDocumentType;
  documentNumber: string;
  issuedAt: string;
  expiresAt: string | null;
  fileUrl: string | null;
  status: VehicleDocumentStatus;
  createdAt: string;
  updatedAt: string;
  deliveries?: VehicleDocumentDelivery[];
}
export interface SaleMissingDoc {
  id: string;
  invoicedAt: string | null;
  createdAt: string;
}

/** Timeline de status do chamado — alimenta "Meus chamados" (#765). */
export interface SupportIncidentUpdate {
  id: string;
  incidentId: string;
  status: SupportIncidentStatus;
  clientNote?: string | null;
  createdAt: string;
}

/** Chamado de suporte (self-service, épico #764). */
export interface SupportIncident {
  id: string;
  companyId: string;
  protocol: string;
  title: string;
  description?: string | null;
  route?: string | null;
  appVersion?: string | null;
  requestId?: string | null;
  status: SupportIncidentStatus;
  severity?: SupportIncidentSeverity | null;
  createdAt: string;
  updatedAt: string;
  updates?: SupportIncidentUpdate[];
}
