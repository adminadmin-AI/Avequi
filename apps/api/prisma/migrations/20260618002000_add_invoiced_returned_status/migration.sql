-- AlterEnum: adiciona INVOICED e RETURNED ao SalesOrderStatus
ALTER TYPE "SalesOrderStatus" ADD VALUE 'INVOICED';
ALTER TYPE "SalesOrderStatus" ADD VALUE 'RETURNED';

-- AlterTable: adiciona colunas de data de faturamento e devolução
ALTER TABLE "gdr_sales_orders" ADD COLUMN "invoicedAt" TIMESTAMP(3);
ALTER TABLE "gdr_sales_orders" ADD COLUMN "returnedAt" TIMESTAMP(3);
