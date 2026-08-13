-- #1077 — NFS-e Nacional: modelo de persistência da nota de serviço.
-- Aditiva e idempotente: tabela nova, nenhuma tabela existente é tocada.
-- Reusa o enum FiscalStatus (já existe) — a máquina de estados é a mesma.
CREATE TABLE IF NOT EXISTS "gdr_service_invoices" (
  "id"                        TEXT NOT NULL,
  "companyId"                 TEXT NOT NULL,
  "salesOrderId"              TEXT,
  "status"                    "FiscalStatus" NOT NULL DEFAULT 'PENDING',
  "focusRef"                  TEXT,
  "serieDps"                  VARCHAR(5),
  "numeroDps"                 INTEGER,
  "numeroNfse"                VARCHAR(20),
  "chaveAcesso"               VARCHAR(50),
  "competencia"               DATE,
  "authorizedAt"              TIMESTAMP(3),
  "itemListaServico"          VARCHAR(6),
  "codigoTributacaoMunicipio" VARCHAR(20),
  "codigoNbs"                 VARCHAR(9),
  "municipioPrestacaoIbge"    VARCHAR(7),
  "discriminacao"             TEXT NOT NULL,
  "valorServico"              DECIMAL(14,2) NOT NULL,
  "valorDeducoes"             DECIMAL(14,2) NOT NULL DEFAULT 0,
  "baseCalculo"               DECIMAL(14,2),
  "aliquotaIss"               DECIMAL(5,2),
  "valorIss"                  DECIMAL(14,2),
  "issRetido"                 BOOLEAN NOT NULL DEFAULT false,
  "valorIssRetido"            DECIMAL(14,2),
  "tomadorNome"               TEXT,
  "tomadorDocumento"          VARCHAR(14),
  "tomadorIm"                 VARCHAR(20),
  "tomadorEmail"              TEXT,
  "xml"                       TEXT,
  "xml_url"                   TEXT,
  "danfse_url"                TEXT,
  "rejectionCode"             TEXT,
  "rejectionReason"           TEXT,
  "lastError"                 TEXT,
  "cancelledAt"               TIMESTAMP(3),
  "cancellationReason"        TEXT,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_service_invoices_pkey" PRIMARY KEY ("id")
);

-- Numeração da DPS é do emitente: não pode repetir série+número na mesma empresa
CREATE UNIQUE INDEX IF NOT EXISTS "gdr_service_invoices_companyId_serieDps_numeroDps_key"
  ON "gdr_service_invoices"("companyId", "serieDps", "numeroDps");
CREATE INDEX IF NOT EXISTS "gdr_service_invoices_companyId_status_idx"
  ON "gdr_service_invoices"("companyId", "status");
CREATE INDEX IF NOT EXISTS "gdr_service_invoices_salesOrderId_idx"
  ON "gdr_service_invoices"("salesOrderId");

DO $$ BEGIN
  ALTER TABLE "gdr_service_invoices" ADD CONSTRAINT "gdr_service_invoices_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "gdr_service_invoices" ADD CONSTRAINT "gdr_service_invoices_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "gdr_sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
