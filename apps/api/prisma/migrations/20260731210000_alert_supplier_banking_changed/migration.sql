-- #864 anti-fraude: novo tipo de alerta para TROCA de chave PIX/dados
-- bancários de fornecedor. Aditiva: um valor novo no enum, nada é removido.

-- AlterEnum (idempotente)
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'SUPPLIER_BANKING_CHANGED';
