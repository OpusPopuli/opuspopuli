// Measure-type chips. The brand rations gold to earned moments, so bill types
// are NOT colour-coded (the old 8-colour rainbow violated "gold is the only
// accent"). All types share one neutral chip; the type code itself (AB / SB /
// ACA …) carries the distinction. Kept as a map so a future single-hue scale
// can slot in without touching call sites.
const NEUTRAL_CHIP = "bg-surface-alt text-content-dim";

export const MEASURE_TYPE_STYLES: Record<string, string> = {
  AB: NEUTRAL_CHIP,
  SB: NEUTRAL_CHIP,
  ACA: NEUTRAL_CHIP,
  SCA: NEUTRAL_CHIP,
  ACR: NEUTRAL_CHIP,
  SCR: NEUTRAL_CHIP,
  AJR: NEUTRAL_CHIP,
  SJR: NEUTRAL_CHIP,
};
