-- CreateEnum
CREATE TYPE "MrpSuggestionStatus" AS ENUM ('PENDING', 'CONVERTED', 'DISMISSED');

-- AlterTable: add status, convertedPoId, convertedAt to MrpSuggestion
ALTER TABLE "gdr_mrp_suggestions" ADD COLUMN "status" "MrpSuggestionStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "gdr_mrp_suggestions" ADD COLUMN "convertedPoId" TEXT;
ALTER TABLE "gdr_mrp_suggestions" ADD COLUMN "convertedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "gdr_mrp_suggestions" ADD CONSTRAINT "gdr_mrp_suggestions_convertedPoId_fkey" FOREIGN KEY ("convertedPoId") REFERENCES "gdr_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
