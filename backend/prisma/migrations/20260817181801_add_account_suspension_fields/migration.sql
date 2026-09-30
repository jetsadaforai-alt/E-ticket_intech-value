-- AlterTable
ALTER TABLE "users" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "suspended_by_admin_id" TEXT,
ADD COLUMN     "suspended_reason" TEXT;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "suspended_by_admin_id" TEXT,
ADD COLUMN     "suspended_reason" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_suspended_by_admin_id_fkey" FOREIGN KEY ("suspended_by_admin_id") REFERENCES "admin_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_suspended_by_admin_id_fkey" FOREIGN KEY ("suspended_by_admin_id") REFERENCES "admin_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
