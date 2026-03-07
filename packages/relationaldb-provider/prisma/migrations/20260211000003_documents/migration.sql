-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('Processing', 'Text Extraction Started', 'Text Extraction Complete', 'Text Extraction Failed', 'AI Embeddings Started', 'AI Embeddings Complete', 'AI Embeddings Failed', 'AI Analysis Started', 'AI Analysis Complete', 'AI Analysis Failed', 'Complete');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('generic', 'petition', 'proposition', 'contract', 'form');

-- CreateEnum
CREATE TYPE "AbuseReportReason" AS ENUM ('incorrect_analysis', 'offensive_content', 'wrong_document_type', 'privacy_concern', 'other');

-- CreateEnum
CREATE TYPE "AbuseReportStatus" AS ENUM ('pending', 'reviewed', 'resolved', 'dismissed');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "location" VARCHAR(255) NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" VARCHAR(255) NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'Processing',
    "type" "DocumentType" NOT NULL DEFAULT 'generic',
    "extracted_text" TEXT,
    "content_hash" VARCHAR(64),
    "ocr_confidence" DOUBLE PRECISION,
    "ocr_provider" VARCHAR(50),
    "analysis" JSONB,
    "embedding" vector(1536),
    "scan_location" geography(Point, 4326),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abuse_reports" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" "AbuseReportReason" NOT NULL,
    "description" TEXT,
    "status" "AbuseReportStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abuse_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_user_id_idx" ON "documents"("user_id");

-- CreateIndex
CREATE INDEX "documents_user_id_deleted_at_idx" ON "documents"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "documents_created_at_idx" ON "documents"("created_at");

-- CreateIndex
CREATE INDEX "documents_checksum_idx" ON "documents"("checksum");

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- CreateIndex
CREATE INDEX "documents_content_hash_idx" ON "documents"("content_hash");

-- CreateIndex
CREATE INDEX "abuse_reports_document_id_idx" ON "abuse_reports"("document_id");

-- CreateIndex
CREATE INDEX "abuse_reports_reporter_id_idx" ON "abuse_reports"("reporter_id");

-- CreateIndex
CREATE INDEX "abuse_reports_status_idx" ON "abuse_reports"("status");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
