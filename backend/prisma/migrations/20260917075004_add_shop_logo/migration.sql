-- Additive, nullable column — no backfill needed, existing shops just show the letter avatar until a logo is uploaded.
ALTER TABLE "shops" ADD COLUMN "logo_url" TEXT;
