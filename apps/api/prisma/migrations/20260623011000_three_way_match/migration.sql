-- CreateEnum: ThreeWayMatchResult
CREATE TYPE "ThreeWayMatchResult" AS ENUM ('FULL_MATCH', 'PARTIAL_MATCH', 'MISMATCH');

-- CreateTable: gdr_three_way_matches
CREATE TABLE "gdr_three_way_matches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "inboundNfeId" TEXT,
    "result" "ThreeWayMatchResult" NOT NULL,
    "qtyTolerance" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "priceTolerance" DECIMAL(5,2) NOT NULL DEFAULT 2,
    "details" JSONB NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_three_way_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gdr_three_way_matches_companyId_result_idx" ON "gdr_three_way_matches"("companyId", "result");
CREATE INDEX "gdr_three_way_matches_purchaseOrderId_idx" ON "gdr_three_way_matches"("purchaseOrderId");

-- AddForeignKeys
ALTER TABLE "gdr_three_way_matches" ADD CONSTRAINT "gdr_three_way_matches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_three_way_matches" ADD CONSTRAINT "gdr_three_way_matches_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "gdr_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_three_way_matches" ADD CONSTRAINT "gdr_three_way_matches_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "gdr_goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_three_way_matches" ADD CONSTRAINT "gdr_three_way_matches_inboundNfeId_fkey" FOREIGN KEY ("inboundNfeId") REFERENCES "gdr_inbound_nfe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_three_way_matches" ADD CONSTRAINT "gdr_three_way_matches_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
