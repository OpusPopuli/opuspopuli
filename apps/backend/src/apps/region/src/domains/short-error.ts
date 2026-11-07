/**
 * An error as a log line: a Prisma error's code, or the first line of the
 * message cut short. A Prisma message can quote the whole call it rejected —
 * every vote of a bill, or a summary the model wrote — and neither belongs in
 * a log (bills-phase-b.md, review of the fixes).
 */
export function shortError(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  const message = e instanceof Error ? e.message : String(e);
  return message.split('\n')[0].slice(0, 200);
}
