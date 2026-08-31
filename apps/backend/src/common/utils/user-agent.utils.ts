/**
 * User-agent helpers shared by session creation and activity display.
 *
 * Sessions used to be stored with `deviceType` / `browser` /
 * `operatingSystem` but no `deviceName`, and the settings UI titles
 * each session with its name — so every session in the list read
 * "Unknown Device" no matter how much we actually knew about it.
 */

const DEVICE_PATTERNS: readonly [RegExp, string][] = [
  [/iphone/i, 'iPhone'],
  [/ipad/i, 'iPad'],
  [/ipod/i, 'iPod'],
  [/android.*mobile/i, 'Android phone'],
  [/android/i, 'Android tablet'],
  [/macintosh|mac os x/i, 'Mac'],
  [/windows/i, 'Windows PC'],
  [/cros/i, 'Chromebook'],
  [/linux/i, 'Linux device'],
];

/**
 * A short, human name for the device behind a user agent — "iPhone",
 * "Windows PC". Returns undefined when the agent tells us nothing, so
 * callers can fall back to their own label rather than storing a
 * placeholder.
 */
export function deviceNameFromUserAgent(
  userAgent?: string | null,
): string | undefined {
  if (!userAgent) return undefined;
  for (const [pattern, name] of DEVICE_PATTERNS) {
    if (pattern.test(userAgent)) return name;
  }
  return undefined;
}
