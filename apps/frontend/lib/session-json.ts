/**
 * Read a JSON value out of sessionStorage, or null if it is not there, is not
 * parseable, or is not the shape the caller expects.
 *
 * ── Why every failure is null and none is a throw ────────────────────────
 *
 * The petition flow hands state between pages through sessionStorage, and the
 * receiving page reads it inside a mount effect that has already committed to
 * running. A throw there aborts the pipeline before OCR and strands the user
 * on a dead screen holding a photograph they cannot retake — the capture step
 * is behind them. So a corrupt value must degrade to "absent", never to an
 * exception, no matter how it got corrupt.
 *
 * The `guard` is not optional for a reason. `JSON.parse` returns `any`, and
 * casting it straight to `T` would let a malformed payload through the type
 * system and into a GraphQL variable, where it fails as a server-side
 * validation error on a request the user cannot retry.
 */
export function readSessionJson<T>(
  key: string,
  guard: (value: unknown) => value is T,
): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
