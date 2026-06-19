-- S27C: Portal do Fornecedor

CREATE TABLE "gdr_supplier_tokens" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "description" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gdr_supplier_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_supplier_tokens_token_key" ON "gdr_supplier_tokens"("token");
CREATE INDEX "gdr_supplier_tokens_supplierId_idx" ON "gdr_supplier_tokens"("supplierId");

ALTER TABLE "gdr_supplier_tokens" ADD CONSTRAINT "gdr_supplier_tokens_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "gdr_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
