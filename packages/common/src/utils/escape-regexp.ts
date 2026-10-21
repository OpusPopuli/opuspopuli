/**
 * Escape a literal so it matches itself inside a RegExp.
 *
 * Hoisted here after a third copy appeared in the backend (#1393 review):
 * `region/domains/representatives-sync.service.ts`,
 * `knowledge/domains/personalized-propositions/proposition-scoring.service.ts`
 * and `knowledge/domains/personalized-reps/rep-relevance.service.ts` each had
 * their own. They agreed, but three copies of a security-relevant one-liner
 * is three places to get it wrong — an unescaped literal in a pattern built
 * from data is how a surname like "D'Angelo+Smith" stops matching itself and
 * starts matching something else.
 *
 * @param literal - Text to be matched verbatim
 * @returns The text with every RegExp metacharacter escaped
 */
export function escapeRegExp(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
