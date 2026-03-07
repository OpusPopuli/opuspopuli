-- CreateEnum
CREATE TYPE "LinkSource" AS ENUM ('auto_analysis', 'user_manual');

-- CreateTable
CREATE TABLE "document_propositions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "proposition_id" TEXT NOT NULL,
    "link_source" "LinkSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "matched_text" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_propositions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_propositions_document_id_proposition_id_key" ON "document_propositions"("document_id", "proposition_id");

-- CreateIndex
CREATE INDEX "document_propositions_document_id_idx" ON "document_propositions"("document_id");

-- CreateIndex
CREATE INDEX "document_propositions_proposition_id_idx" ON "document_propositions"("proposition_id");

-- AddForeignKey
ALTER TABLE "document_propositions" ADD CONSTRAINT "document_propositions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_propositions" ADD CONSTRAINT "document_propositions_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "propositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
