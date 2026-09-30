-- AlterTable
ALTER TABLE "events" ADD COLUMN "relaunched_to_event_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "events_relaunched_to_event_id_key" ON "events"("relaunched_to_event_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_relaunched_to_event_id_fkey" FOREIGN KEY ("relaunched_to_event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
