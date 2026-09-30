-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN "user_last_read_at" TIMESTAMP(3);
ALTER TABLE "support_tickets" ADD COLUMN "admin_last_read_at" TIMESTAMP(3);
