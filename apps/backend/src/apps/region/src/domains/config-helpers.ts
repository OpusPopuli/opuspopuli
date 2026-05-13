import { ConfigService } from '@nestjs/config';

/**
 * Read an environment variable as a positive integer.
 * Returns `fallback` when the variable is absent, empty, non-numeric, or ≤ 0.
 */
export function readPositiveInt(
  config: ConfigService | undefined,
  envKey: string,
  fallback: number,
): number {
  const raw = config?.get<string>(envKey);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read an environment variable as a positive integer.
 * Returns `undefined` when the variable is absent, empty, non-numeric, or ≤ 0.
 */
export function readOptionalPositiveInt(
  config: ConfigService | undefined,
  envKey: string,
): number | undefined {
  const raw = config?.get<string>(envKey);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
