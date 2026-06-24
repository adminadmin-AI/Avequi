-- AlterTable: add tracksSerial to Product
ALTER TABLE "gdr_products" ADD COLUMN "tracksSerial" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: add serialNumberId to SaleItem
ALTER TABLE "gdr_sale_items" ADD COLUMN "serialNumberId" TEXT;

-- AddForeignKey
ALTER TABLE "gdr_sale_items" ADD CONSTRAINT "gdr_sale_items_serialNumberId_fkey" FOREIGN KEY ("serialNumberId") REFERENCES "gdr_serial_number"("id") ON DELETE SET NULL ON UPDATE CASCADE;
