-- S20: WMS Polimento — adiciona CANCELLED ao enum InventoryCountStatus

ALTER TYPE "InventoryCountStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
