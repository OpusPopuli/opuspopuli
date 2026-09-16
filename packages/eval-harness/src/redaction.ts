/**
 * Redact proponent contact details from measure text before it is committed
 * as a fixture.
 *
 * ## Why this exists
 *
 * `propositions.full_text` is not only measure text. For AG-filed California
 * initiatives it includes the proponent's transmittal letter, and that letter
 * carries a named individual's postal address, personal email address and
 * phone number. Nine of the ten measures in `fulltext-propositions.json`
 * contain at least one; two carry street addresses that read as residential
 * ("645 Taraval Street", "7031 Mission Street").
 *
 * These are public records — the Attorney General publishes proponent contact
 * details so the public can reach them, and CCPA excludes information lawfully
 * made available from government records from "personal information"
 * (Cal. Civ. Code § 1798.140(v)(2)). So this is very probably exempt.
 *
 * It is redacted anyway, for three reasons that do not depend on that:
 *
 *   1. **Committing is hard to reverse.** A fixture lands in git history. A
 *      public record being republished in a source repository as test data is
 *      a different act from the state publishing it, and not one to perform by
 *      default while merely assuming an exemption applies.
 *   2. **It is not measure content.** A proponent's phone number is filing
 *      furniture. Keeping it adds nothing an analysis should be scored on.
 *   3. **It corrupts the scorers.** Phone numbers, ZIP codes and suite numbers
 *      are digit strings, and the grounding scorer counts digit strings. A
 *      model quoting a ZIP code back would score as a grounded figure.
 *
 * ## What this does NOT claim
 *
 * Production sends `full_text` to the model **unredacted** — this module
 * changes the fixture, not the pipeline. That the proposition-analysis path
 * puts proponent contact details into an LLM prompt is a real finding about
 * production and is recorded as one; it is not fixed here, and this harness
 * must not be read as evidence that it was.
 *
 * Redaction is deterministic and the placeholders are visible, so a reviewer
 * can see exactly what was removed and re-derive it from the database.
 */

export interface RedactionHit {
  kind: "email" | "phone" | "street-address";
  /** What was replaced, kept only in-memory for reporting. Never persisted. */
  value: string;
}

export interface RedactionResult {
  text: string;
  hits: RedactionHit[];
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;

/** North American formats as they appear in these filings. */
const PHONE = /\b\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;

/**
 * Street addresses only — a number followed by a street name and a street-type
 * word. Deliberately narrow: "Section 3" and "Article XIII" must survive, and
 * so must the Sacramento office addresses that appear as part of the filing
 * apparatus rather than as anyone's home.
 */
const STREET =
  /\b\d{2,6}\s+(?:[A-Z][A-Za-z.'-]+\s+){1,4}(?:ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|RD|ROAD|DR|DRIVE|LN|LANE|WAY|CT|COURT|PL|PLACE|TERRACE|PKWY|PARKWAY)\b\.?(?:\s+(?:SUITE|STE|#|APT|UNIT)\s*[\w-]+)?/gi;

export function redactContactDetails(text: string): RedactionResult {
  const hits: RedactionHit[] = [];

  const replace = (
    input: string,
    pattern: RegExp,
    kind: RedactionHit["kind"],
    token: string,
  ): string =>
    input.replace(pattern, (match) => {
      hits.push({ kind, value: match });
      // Same length is NOT preserved: padding to length would imply the
      // original is recoverable from the fixture, and it should not be.
      return token;
    });

  let out = replace(text, EMAIL, "email", "[REDACTED-EMAIL]");
  out = replace(out, PHONE, "phone", "[REDACTED-PHONE]");
  out = replace(out, STREET, "street-address", "[REDACTED-ADDRESS]");

  return { text: out, hits };
}

/**
 * Does this text still carry contact details? Used as a post-condition on
 * fixture generation, so a pattern that stops matching cannot silently start
 * committing personal data again.
 */
export function findContactDetails(text: string): RedactionHit[] {
  return redactContactDetails(text).hits;
}
