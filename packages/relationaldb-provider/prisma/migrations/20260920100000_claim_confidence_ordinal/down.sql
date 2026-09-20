-- Reverse of the ordinal change. Lossy by nature: a word cannot carry the
-- precision of the float it replaced, so the mapping is the midpoint of each
-- band rather than a recovered value.
ALTER TABLE "claims"
  ALTER COLUMN "confidence" TYPE DOUBLE PRECISION
  USING CASE "confidence"
    WHEN 'high' THEN 0.9
    WHEN 'medium' THEN 0.6
    WHEN 'low' THEN 0.3
    ELSE NULL
  END;
