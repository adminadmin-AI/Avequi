// Jest mock stub for the Prisma 7 generated client (ESM-only, incompatible with Jest CJS mode)
// This stub allows unit tests to import PrismaService without loading the real generated client.

export class PrismaClient {
  $connect = jest.fn();
  $disconnect = jest.fn();
  $on = jest.fn();
  $queryRaw = jest.fn();
  $executeRaw = jest.fn();
  $transaction = jest.fn();
}

// Re-export Prisma namespace with sql tag
export const Prisma = {
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  join: jest.fn(),
  raw: jest.fn(),
  Decimal: class Decimal {
    constructor(public val: unknown) {}
    toNumber() { return Number(this.val); }
    toString() { return String(this.val); }
  },
};

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum CompanyType {
  MATRIZ = 'MATRIZ',
  FILIAL = 'FILIAL',
}

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  DIRECTOR = 'DIRECTOR',
  MANAGER = 'MANAGER',
  COMMERCIAL = 'COMMERCIAL',
  PRODUCTION = 'PRODUCTION',
  QUALITY = 'QUALITY',
  WAREHOUSE = 'WAREHOUSE',
  FINANCIAL = 'FINANCIAL',
  STORE = 'STORE',
  READER = 'READER',
}

export enum ProductType {
  RAW_MATERIAL = 'RAW_MATERIAL',
  SEMI_FINISHED = 'SEMI_FINISHED',
  FINISHED_GOOD = 'FINISHED_GOOD',
  CONSUMABLE = 'CONSUMABLE',
  SERVICE = 'SERVICE',
  COMPONENT = 'COMPONENT',
}

export enum UnitOfMeasure {
  UN = 'UN',
  KG = 'KG',
  G = 'G',
  M = 'M',
  M2 = 'M2',
  M3 = 'M3',
  L = 'L',
  PC = 'PC',
  CX = 'CX',
  PR = 'PR',
}

export enum CustomerType {
  INDIVIDUAL = 'INDIVIDUAL',
  COMPANY = 'COMPANY',
}

export enum MovementType {
  ENTRY = 'ENTRY',
  EXIT = 'EXIT',
  ADJUSTMENT = 'ADJUSTMENT',
  REVERSAL = 'REVERSAL',
  TRANSFER_OUT = 'TRANSFER_OUT',
  TRANSFER_IN = 'TRANSFER_IN',
}

export enum PurchaseRequestStatus {
  OPEN = 'OPEN',
  APPROVED = 'APPROVED',
  CONVERTED = 'CONVERTED',
  CANCELLED = 'CANCELLED',
}

export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

export enum SalesOrderStatus {
  DRAFT = 'DRAFT',
  RESERVED = 'RESERVED',
  CONFIRMED = 'CONFIRMED',
  INVOICED = 'INVOICED',
  RETURNED = 'RETURNED',
  CANCELLED = 'CANCELLED',
}

export enum FiscalDocumentType {
  NFE = 'NFE',
  NFCE = 'NFCE',
}

export enum FiscalStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  AUTHORIZED = 'AUTHORIZED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  ERROR = 'ERROR',
}

export enum FinancialEntryType {
  RECEIVABLE = 'RECEIVABLE',
  PAYABLE = 'PAYABLE',
}

export enum FinancialEntryStatus {
  OPEN = 'OPEN',
  OVERDUE = 'OVERDUE',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

export enum TransferStatus {
  DRAFT = 'DRAFT',
  DISPATCHED = 'DISPATCHED',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

export enum MrpRunStatus {
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  ERROR = 'ERROR',
}

export enum MrpSuggestionType {
  PURCHASE = 'PURCHASE',
  PRODUCTION = 'PRODUCTION',
}

export enum ProductionOrderStatus {
  DRAFT = 'DRAFT',
  RELEASED = 'RELEASED',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}

export enum LocationType {
  RECEIVING = 'RECEIVING',
  STORAGE = 'STORAGE',
  STAGING = 'STAGING',
}

export enum ReceivingStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
}

export enum PutawayStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
}

export enum PickingStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
}

export enum PickTaskStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
}

export enum InventoryCountType {
  CYCLIC = 'CYCLIC',
  FULL = 'FULL',
}

export enum InventoryCountStatus {
  DRAFT = 'DRAFT',
  IN_PROGRESS = 'IN_PROGRESS',
  RECONCILED = 'RECONCILED',
  CANCELLED = 'CANCELLED',
}

export enum InventoryItemStatus {
  PENDING = 'PENDING',
  COUNTED = 'COUNTED',
}

export enum AlertType {
  STOCK_MIN = 'STOCK_MIN',
  PAYABLE_DUE = 'PAYABLE_DUE',
  PRODUCTION_LATE = 'PRODUCTION_LATE',
  NFE_REJECTED = 'NFE_REJECTED',
  MRP_RUN_DONE = 'MRP_RUN_DONE',
  FOCUS_NFE_DOWN = 'FOCUS_NFE_DOWN',
  QC_INSPECTION_FAILED = 'QC_INSPECTION_FAILED',
  MAINTENANCE_DUE = 'MAINTENANCE_DUE',
}

export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

export enum InspectionType {
  RECEIVING = 'RECEIVING',
  IN_PROCESS = 'IN_PROCESS',
  FINAL = 'FINAL',
}

export enum InspectionStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  ON_HOLD = 'ON_HOLD',
}

export enum NcrStatus {
  OPEN = 'OPEN',
  UNDER_ANALYSIS = 'UNDER_ANALYSIS',
  CORRECTIVE_ACTION = 'CORRECTIVE_ACTION',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum NcrSeverity {
  MINOR = 'MINOR',
  MAJOR = 'MAJOR',
  CRITICAL = 'CRITICAL',
}

export enum SerialStatus {
  IN_PRODUCTION = 'IN_PRODUCTION',
  IN_STOCK = 'IN_STOCK',
  SOLD = 'SOLD',
  TRANSFERRED = 'TRANSFERRED',
  SCRAPPED = 'SCRAPPED',
}

export enum EquipmentStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  UNDER_MAINTENANCE = 'UNDER_MAINTENANCE',
  SCRAPPED = 'SCRAPPED',
}

export enum MaintenanceType {
  PREVENTIVE = 'PREVENTIVE',
  CORRECTIVE = 'CORRECTIVE',
  CALIBRATION = 'CALIBRATION',
  INSPECTION = 'INSPECTION',
}

export enum MaintenanceOrderStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}

export enum QuotationStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  CONVERTED = 'CONVERTED',
}

export enum InboundNfeStatus {
  PENDING = 'PENDING',
  MATCHED = 'MATCHED',
  IMPORTED = 'IMPORTED',
  REJECTED = 'REJECTED',
}

export enum BatchStatus {
  ACTIVE = 'ACTIVE',
  QUARANTINE = 'QUARANTINE',
  CONSUMED = 'CONSUMED',
  EXPIRED = 'EXPIRED',
  SCRAPPED = 'SCRAPPED',
}

export enum BatchEventType {
  RECEIPT = 'RECEIPT',
  TRANSFER = 'TRANSFER',
  CONSUMPTION = 'CONSUMPTION',
  ADJUSTMENT = 'ADJUSTMENT',
  QUARANTINE = 'QUARANTINE',
  RELEASE = 'RELEASE',
  EXPIRY = 'EXPIRY',
  SCRAP = 'SCRAP',
}

export enum FinancialCategoryType {
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
  TRANSFER = 'TRANSFER',
  GROUP = 'GROUP',
}

export enum PayableStatus {
  OPEN = 'OPEN',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  OVERDUE = 'OVERDUE',
}

export enum ReceivableStatus {
  OPEN = 'OPEN',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  OVERDUE = 'OVERDUE',
}

