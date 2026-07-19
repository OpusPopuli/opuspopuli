-- #905: bill_votes.chamber VARCHAR(20) is the next createMany overflow after
-- #901/#902 widened motion_text. The LLM votes-extraction sometimes emits a
-- chamber string longer than 20 chars (a full committee/reading label rather
-- than just "Assembly"/"Senate"); because createMany is atomic, one over-long
-- value drops the bill's entire vote set. chamber has no natural length when
-- LLM-extracted → text. varchar(n)→text is a no-rewrite widening in Postgres,
-- additive and prod-safe. Matches the live ALTER already applied on the node.
ALTER TABLE "bill_votes" ALTER COLUMN "chamber" TYPE TEXT;
