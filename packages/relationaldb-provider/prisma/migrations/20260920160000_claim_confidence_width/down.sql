-- Narrowing back. Lossy only if a value longer than 10 characters was stored,
-- which the normaliser does not produce.
ALTER TABLE "claims" ALTER COLUMN "confidence" TYPE VARCHAR(10)
  USING left("confidence", 10);
