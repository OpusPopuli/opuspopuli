/**
 * Deterministically offsets the minute field of a cron expression using a
 * hash of the seed string. Spreads per-source jobs across the hour so they
 * don't all fire simultaneously.
 *
 * Example: staggeredCron('0 2 * * *', 'california-meetings') → '33 2 * * *'
 */
export function staggeredCron(baseCron: string, seed: string): string {
  const offset = [...seed].reduce((n, c) => n + c.charCodeAt(0), 0) % 60;
  const parts = baseCron.split(' ');
  parts[0] = String(offset);
  return parts.join(' ');
}
