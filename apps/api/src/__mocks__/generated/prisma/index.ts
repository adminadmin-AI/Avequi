// Jest mock stub for the Prisma 7 generated client (ESM-only, incompatible with Jest CJS mode)
// This stub allows unit tests to import PrismaService without loading the real generated client.

export class PrismaClient {
  $connect = jest.fn();
  $disconnect = jest.fn();
  $on = jest.fn();
  $queryRaw = jest.fn();
  $executeRaw = jest.fn();
  $transaction = jest.fn();
  // Client extensions ($extends) retornam o próprio client no stub —
  // suficiente para o PrismaService construir o extendedClient em testes.
  $extends = jest.fn(() => this);
}

// Mirror of Prisma.PrismaClientKnownRequestError (same shape as @prisma/client/runtime)
// so filters/services can be tested against Prisma errors (P2002, P2025, P2003...).
class PrismaClientKnownRequestError extends Error {
  code: string;
  meta?: Record<string, unknown>;
  clientVersion: string;

  constructor(
    message: string,
    options: { code: string; clientVersion: string; meta?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
    this.code = options.code;
    this.clientVersion = options.clientVersion;
    this.meta = options.meta;
  }
}

// Decimal mock com semântica compatível com Decimal.js (comparações, aritmética).
// Armazena um único campo numérico normalizado (`d`) para que `toEqual` do Jest
// considere iguais instâncias construídas a partir de string, number ou Decimal.
// Limitação conhecida: usa `number` por baixo (IEEE-754), suficiente para testes
// unitários; NÃO replica precisão arbitrária do Decimal.js real.
class DecimalMock {
  private readonly d: number;

  constructor(value: unknown) {
    this.d = DecimalMock.toNum(value);
  }

  private static toNum(value: unknown): number {
    if (value instanceof DecimalMock) return value.d;
    return Number(value);
  }

  // ── Aritmética ──
  plus(other: unknown) { return new DecimalMock(this.d + DecimalMock.toNum(other)); }
  add(other: unknown) { return this.plus(other); }
  minus(other: unknown) { return new DecimalMock(this.d - DecimalMock.toNum(other)); }
  sub(other: unknown) { return this.minus(other); }
  times(other: unknown) { return new DecimalMock(this.d * DecimalMock.toNum(other)); }
  mul(other: unknown) { return this.times(other); }
  div(other: unknown) { return new DecimalMock(this.d / DecimalMock.toNum(other)); }
  dividedBy(other: unknown) { return this.div(other); }
  abs() { return new DecimalMock(Math.abs(this.d)); }
  negated() { return new DecimalMock(-this.d); }
  neg() { return this.negated(); }

  // ── Comparações ──
  comparedTo(other: unknown) {
    const o = DecimalMock.toNum(other);
    return this.d < o ? -1 : this.d > o ? 1 : 0;
  }
  cmp(other: unknown) { return this.comparedTo(other); }
  equals(other: unknown) { return this.d === DecimalMock.toNum(other); }
  eq(other: unknown) { return this.equals(other); }
  greaterThan(other: unknown) { return this.d > DecimalMock.toNum(other); }
  gt(other: unknown) { return this.greaterThan(other); }
  greaterThanOrEqualTo(other: unknown) { return this.d >= DecimalMock.toNum(other); }
  gte(other: unknown) { return this.greaterThanOrEqualTo(other); }
  lessThan(other: unknown) { return this.d < DecimalMock.toNum(other); }
  lt(other: unknown) { return this.lessThan(other); }
  lessThanOrEqualTo(other: unknown) { return this.d <= DecimalMock.toNum(other); }
  lte(other: unknown) { return this.lessThanOrEqualTo(other); }
  isZero() { return this.d === 0; }
  isNegative() { return this.d < 0; }
  isPositive() { return this.d > 0; }

  // ── Conversões ──
  toNumber() { return this.d; }
  toString() { return String(this.d); }
  toFixed(dp?: number) { return dp !== undefined ? this.d.toFixed(dp) : String(this.d); }
  toDecimalPlaces(dp: number) { return new DecimalMock(Number(this.d.toFixed(dp))); }
  toJSON() { return this.toString(); }
  valueOf() { return this.d; }
}

// Re-export Prisma namespace with sql tag
export const Prisma = {
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  join: jest.fn(),
  raw: jest.fn(),
  // defineExtension é identidade no client real quando recebe um objeto de
  // definição; o stub replica isso para a extensão RLS.
  defineExtension: (definition: unknown) => definition,
  Decimal: DecimalMock,
  PrismaClientKnownRequestError,
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
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

export enum SalesOrderStatus {
  DRAFT = 'DRAFT',
  RESERVED = 'RESERVED',
  CONFIRMED = 'CONFIRMED',
  AWAITING_PICKING = 'AWAITING_PICKING',
  AWAITING_CONFERENCE = 'AWAITING_CONFERENCE',
  READY_TO_INVOICE = 'READY_TO_INVOICE',
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
  RESERVED_FOR_SALE = 'RESERVED_FOR_SALE',
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


export enum BinRegistrationStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  REGISTERED = 'REGISTERED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum AtpveStatus {
  PENDING = 'PENDING',
  ISSUED = 'ISSUED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentMethod {
  BOLETO = 'BOLETO',
  PIX = 'PIX',
  TED = 'TED',
  DINHEIRO = 'DINHEIRO',
  CARTAO = 'CARTAO',
  CHEQUE = 'CHEQUE',
}

export enum ScheduledPaymentStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export enum IcmsIndicator {
  CONTRIBUINTE = 'CONTRIBUINTE',
  ISENTO = 'ISENTO',
  NAO_CONTRIBUINTE = 'NAO_CONTRIBUINTE',
}
