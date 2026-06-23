-- AlterEnum: adicionar tipos de operação para CFOPs industriais (#163)
ALTER TYPE "TaxOperationType" ADD VALUE 'DEVOLUCAO_COMPRA';
ALTER TYPE "TaxOperationType" ADD VALUE 'REMESSA_CONSERTO';
ALTER TYPE "TaxOperationType" ADD VALUE 'RETORNO_CONSERTO';
ALTER TYPE "TaxOperationType" ADD VALUE 'AMOSTRA_GRATIS';
ALTER TYPE "TaxOperationType" ADD VALUE 'BONIFICACAO';
