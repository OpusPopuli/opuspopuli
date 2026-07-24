-- #941: candidate-committee → representative link. Resolved by the
-- CandidateCommitteeLinkerService from a committee's candidateName +
-- candidateOffice. Additive, nullable column — prod-safe, no table rewrite.
-- FK is ON DELETE SET NULL so removing a representative just unlinks their
-- committees rather than cascading a delete of finance rows.
ALTER TABLE "committees" ADD COLUMN "representative_id" TEXT;

CREATE INDEX "committees_representative_id_idx" ON "committees"("representative_id");

ALTER TABLE "committees" ADD CONSTRAINT "committees_representative_id_fkey"
  FOREIGN KEY ("representative_id") REFERENCES "representatives"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
