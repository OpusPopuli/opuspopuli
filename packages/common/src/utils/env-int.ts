/**
 * An integer env knob, or `fallback` when it is unset, empty, not an integer
 * (`"2.5"`, `"lots"`), or below `min`.
 *
 * @param name - The environment variable
 * @param fallback - The default, returned for anything unusable
 * @param min - The smallest accepted value; 1 unless 0 means "off"
 */
export function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  return raw?.trim() && Number.isSafeInteger(parsed) && parsed >= min
    ? parsed
    : fallback;
}
