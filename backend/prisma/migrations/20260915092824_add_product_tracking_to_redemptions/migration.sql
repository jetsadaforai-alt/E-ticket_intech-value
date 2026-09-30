-- AlterTable
ALTER TABLE "redemptions" ADD COLUMN     "product_id" TEXT,
ADD COLUMN     "product_unavailable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "product_substitutions" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "out_of_stock_product_id" TEXT NOT NULL,
    "substitute_product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_substitutions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_substitutions" ADD CONSTRAINT "product_substitutions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_substitutions" ADD CONSTRAINT "product_substitutions_out_of_stock_product_id_fkey" FOREIGN KEY ("out_of_stock_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_substitutions" ADD CONSTRAINT "product_substitutions_substitute_product_id_fkey" FOREIGN KEY ("substitute_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
