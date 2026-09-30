-- AlterTable
ALTER TABLE "events" ADD COLUMN     "banned_at" TIMESTAMP(3),
ADD COLUMN     "banned_by_admin_id" TEXT,
ADD COLUMN     "banned_reason" TEXT;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_banned_by_admin_id_fkey" FOREIGN KEY ("banned_by_admin_id") REFERENCES "admin_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
