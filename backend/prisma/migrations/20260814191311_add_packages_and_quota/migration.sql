-- AlterTable
ALTER TABLE "events" ADD COLUMN     "ticket_cap" INTEGER NOT NULL DEFAULT 0;

-- Backfill: events created before the quota system have no ceiling recorded, and a
-- literal 0 would read as "already over cap" everywhere. Their real ceiling is
-- whatever batch size they were actually created with.
UPDATE "events" e
SET "ticket_cap" = COALESCE(
  (SELECT tb."total_qty" FROM "ticket_batches" tb WHERE tb."event_id" = e."id"),
  0
);

-- CreateTable
CREATE TABLE "packages" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "price_baht" DECIMAL(10,2) NOT NULL,
    "event_quota" INTEGER NOT NULL,
    "ticket_per_event" INTEGER NOT NULL,
    "event_topup_price" DECIMAL(10,2) NOT NULL,
    "ticket_topup_price" DECIMAL(10,2) NOT NULL,
    "topup_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_quotas" (
    "vendor_id" TEXT NOT NULL,
    "current_package_id" TEXT NOT NULL,
    "ticket_balance" INTEGER NOT NULL DEFAULT 0,
    "event_balance" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_quotas_pkey" PRIMARY KEY ("vendor_id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "package_code_snapshot" TEXT NOT NULL,
    "unit_price_snapshot" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount_baht" DECIMAL(10,2) NOT NULL,
    "ticket_quota_added" INTEGER NOT NULL DEFAULT 0,
    "event_quota_added" INTEGER NOT NULL DEFAULT 0,
    "target_event_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amount_baht" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider_ref" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_ledgers" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "ticket_delta" INTEGER NOT NULL,
    "event_delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "packages_code_key" ON "packages"("code");

-- CreateIndex
CREATE UNIQUE INDEX "packages_tier_key" ON "packages"("tier");

-- CreateIndex
CREATE INDEX "purchases_vendor_id_created_at_idx" ON "purchases"("vendor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_purchase_id_key" ON "payments"("purchase_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_ref_key" ON "payments"("provider_ref");

-- CreateIndex
CREATE INDEX "quota_ledgers_vendor_id_created_at_idx" ON "quota_ledgers"("vendor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quota_ledgers_reason_ref_id_key" ON "quota_ledgers"("reason", "ref_id");

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_updated_by_admin_id_fkey" FOREIGN KEY ("updated_by_admin_id") REFERENCES "admin_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_quotas" ADD CONSTRAINT "vendor_quotas_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_quotas" ADD CONSTRAINT "vendor_quotas_current_package_id_fkey" FOREIGN KEY ("current_package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_target_event_id_fkey" FOREIGN KEY ("target_event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_ledgers" ADD CONSTRAINT "quota_ledgers_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
