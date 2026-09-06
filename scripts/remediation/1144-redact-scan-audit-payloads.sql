-- #1144 remediation: redact scan image payloads already sitting in audit_logs.
--
-- The masking fix stops NEW rows from carrying ProcessScanInput.data /
-- ExtractTextFromBase64Input.data. This cleans the rows written before it:
-- every audited mutation whose input carried a `data` field has the full
-- base64 photograph stored verbatim, identity-linked, for the 90-day
-- retention window.
--
-- Shape verified against real rows: inputVariables is the raw GraphQL args
-- object, so payloads sit at `input -> data` (input-object mutations) or at
-- the top level. Both handled; idempotent; scoped to rows that actually carry
-- the field so the UPDATE touches nothing else.
--
-- Run against production AT deploy time (coordinated with the release that
-- carries the masking fix), then record the row counts + date on #1144.

BEGIN;

-- Nested: { input: { data: <base64>, ... } }
UPDATE audit_logs
   SET input_variables = jsonb_set(
         input_variables::jsonb,
         '{input,data}',
         '"[REDACTED]"'::jsonb
       )
 WHERE input_variables::jsonb -> 'input' ? 'data'
   AND input_variables::jsonb #>> '{input,data}' IS DISTINCT FROM '[REDACTED]';

-- Top-level: { data: <base64>, ... }
UPDATE audit_logs
   SET input_variables = jsonb_set(
         input_variables::jsonb,
         '{data}',
         '"[REDACTED]"'::jsonb
       )
 WHERE input_variables::jsonb ? 'data'
   AND input_variables::jsonb ->> 'data' IS DISTINCT FROM '[REDACTED]';

COMMIT;

-- Verification (run after; both counts must be 0):
--   SELECT count(*) FROM audit_logs
--    WHERE (input_variables::jsonb #>> '{input,data}' IS DISTINCT FROM '[REDACTED]'
--           AND input_variables::jsonb -> 'input' ? 'data')
--       OR (input_variables::jsonb ->> 'data' IS DISTINCT FROM '[REDACTED]'
--           AND input_variables::jsonb ? 'data');
