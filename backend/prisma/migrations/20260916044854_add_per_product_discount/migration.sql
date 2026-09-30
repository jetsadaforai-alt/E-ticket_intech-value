-- AlterTable
ALTER TABLE "event_products" ADD COLUMN     "discount_value_baht" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ticket_batches" ADD COLUMN     "fallback_discount_value_baht" DECIMAL(10,2);
